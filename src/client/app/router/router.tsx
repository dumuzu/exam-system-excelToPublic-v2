import { QueryClient } from "@tanstack/react-query";
import {
  Outlet,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router";

import { adminSessionQueryOptions } from "../../features/auth/api/authQueries.ts";
import { accountPageQueryOptions, managedSubjectQueryOptions } from "../../features/accounts/api/accountQueries.ts";
import { ApiRequestError } from "../../shared/api/httpClient.ts";
import { PageSkeleton } from "../../shared/patterns/PageStates.tsx";
import { examRoomCodeSchema } from "../../../types/contracts/exam-room.ts";
import {
  accountsSearchSchema,
  authoringSearchSchema,
  dashboardSearchSchema,
  examRoomSearchSchema,
  examsSearchSchema,
  resultsSearchSchema,
} from "../../../types/routes/admin-search.ts";

interface RouterContext {
  queryClient: QueryClient;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => (
        failureCount < 1
        && (!(error instanceof ApiRequestError) || error.status >= 500)
      ),
    },
    mutations: { retry: false },
  },
});

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
  notFoundComponent: () => (
    <main className="routeState">
      <p className="stateEyebrow">404</p>
      <h1>Page not found</h1>
      <a href="/admin/">Return to administration</a>
    </main>
  ),
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "login",
}).lazy(() => import("../../features/auth/routes/login.lazy.tsx").then((module) => module.Route));

async function requireAdminSession(queryClient: QueryClient, revalidate = false) {
  try {
    const options = adminSessionQueryOptions();
    return revalidate
      ? await queryClient.fetchQuery({ ...options, staleTime: 0 })
      : await queryClient.ensureQueryData(options);
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 401) {
      queryClient.clear();
      throw redirect({ to: "/login", replace: true });
    }
    throw error;
  }
}

async function requireTeachingSession(queryClient: QueryClient) {
  const session = await requireAdminSession(queryClient);
  if (session.workspaceKind === "system") {
    throw redirect({ to: "/system", replace: true });
  }
  return session;
}

const systemRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "system",
  loader: async ({ context }) => {
    const session = await requireAdminSession(context.queryClient, true);
    if (!session.navigation.some((item) => item.key === "system" && item.permission === "manage_accounts")) {
      throw redirect({ to: "/dashboard", search: {}, replace: true });
    }
    return { session };
  },
  pendingComponent: () => <main className="routeState"><PageSkeleton rows={9} /></main>,
}).lazy(() => import("../../features/system/routes/system.lazy.tsx").then((module) => module.Route));

const subjectsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "subjects",
  loader: async ({ context }) => {
    const session = await requireAdminSession(context.queryClient, true);
    if (!session.navigation.some((item) => item.key === "subjects" && item.permission === "manage_accounts")) {
      throw redirect({ to: "/dashboard", search: {}, replace: true });
    }
    const { subjectCatalogQueryOptions } = await import("../../features/subjects/api/subjectQueries.ts");
    await context.queryClient.prefetchQuery(subjectCatalogQueryOptions());
    return { session };
  },
  pendingComponent: () => <main className="routeState"><PageSkeleton rows={8} /></main>,
}).lazy(() => import("../../features/subjects/routes/subjects.lazy.tsx").then((module) => module.Route));

const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "dashboard",
  validateSearch: (search) => dashboardSearchSchema.parse(search),
  loaderDeps: ({ search }) => ({ subjectId: search.subjectId }),
  loader: async ({ context, deps }) => {
    const session = await requireTeachingSession(context.queryClient);
    const requested = session.workspaceSubjects.find((subject) => subject.id === deps.subjectId);
    const selected = requested ?? session.workspaceSubjects[0] ?? null;
    if (selected && deps.subjectId !== selected.id) {
      throw redirect({ to: "/dashboard", search: { subjectId: selected.id }, replace: true });
    }
    return { session, subjectId: selected?.id ?? null };
  },
  pendingComponent: () => <main className="routeState"><PageSkeleton rows={5} /></main>,
}).lazy(() => import("../../features/dashboard/routes/dashboard.lazy.tsx").then((module) => module.Route));

const examsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "exams",
  validateSearch: (search) => examsSearchSchema.parse(search),
  loaderDeps: ({ search }) => search,
  loader: async ({ context, deps }) => {
    const session = await requireTeachingSession(context.queryClient);
    const availableSubjects = session.workspaceSubjects.filter((subject) => subject.permissions.includes("view_room"));
    const requested = availableSubjects.find((subject) => subject.id === deps.subjectId);
    const selected = requested ?? availableSubjects[0] ?? null;
    if (selected && deps.subjectId !== selected.id) {
      throw redirect({ to: "/exams", search: { ...deps, subjectId: selected.id }, replace: true });
    }
    return { session, subjectId: selected?.id ?? null };
  },
  pendingComponent: () => <main className="routeState"><PageSkeleton rows={8} /></main>,
}).lazy(() => import("../../features/exams/routes/exams.lazy.tsx").then((module) => module.Route));

const examRoomRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "exams/$examCode/room",
  validateSearch: (search) => examRoomSearchSchema.parse(search),
  loader: async ({ context, params }) => {
    const session = await requireTeachingSession(context.queryClient);
    if (!session.permissions.includes("view_room")) {
      throw redirect({ to: "/dashboard", search: {}, replace: true });
    }
    const examCode = examRoomCodeSchema.parse(params.examCode.toUpperCase());
    const { examRoomQueryOptions } = await import("../../features/exam-room/api/examRoomQueries.ts");
    // 不阻塞路由切换；页面复用同一 Query 请求并负责呈现资源级 403/404。
    void context.queryClient.prefetchQuery(examRoomQueryOptions(examCode));
    return { examCode, session };
  },
  pendingComponent: () => <main className="routeState"><PageSkeleton rows={9} /></main>,
}).lazy(() => import("../../features/exam-room/routes/examRoom.lazy.tsx").then((module) => module.Route));

const authoringRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "exams/new",
  validateSearch: (search) => authoringSearchSchema.parse(search),
  loaderDeps: ({ search }) => search,
  loader: async ({ context, deps }) => {
    const session = await requireTeachingSession(context.queryClient);
    const availableSubjects = session.workspaceSubjects.filter((subject) => subject.permissions.includes("compose_exam"));
    const requested = availableSubjects.find((subject) => subject.id === deps.subjectId);
    const selected = requested ?? availableSubjects[0] ?? null;
    if (!selected) {
      throw redirect({ to: "/dashboard", search: {}, replace: true });
    }
    const requestedAssessmentType = selected.assessmentTypeKeys.find((key) => key === deps.assessmentTypeKey);
    const assessmentTypeKey = requestedAssessmentType ?? selected.assessmentTypeKeys[0]!;
    if (deps.subjectId !== selected.id || deps.assessmentTypeKey !== assessmentTypeKey) {
      throw redirect({ to: "/exams/new", search: { subjectId: selected.id, assessmentTypeKey }, replace: true });
    }
    const {
      authoringConfigurationQueryOptions,
      authoringFunctionQueryOptions,
      authoringModeQueryOptions,
    } = await import("../../features/exam-authoring/api/authoringQueries.ts");
    // 路由意图预加载时同步预热首屏数据；组件挂载后会复用同一批 Query 请求。
    void Promise.all([
      context.queryClient.prefetchQuery(authoringModeQueryOptions(selected.id, assessmentTypeKey)),
      context.queryClient.prefetchQuery(authoringFunctionQueryOptions(selected.id, assessmentTypeKey)),
      context.queryClient.prefetchQuery(authoringConfigurationQueryOptions(selected.id, assessmentTypeKey)),
    ]);
    return { assessmentTypeKey, session, subjectId: selected.id };
  },
  pendingComponent: () => <main className="routeState"><PageSkeleton rows={9} /></main>,
}).lazy(() => import("../../features/exam-authoring/routes/authoring.lazy.tsx").then((module) => module.Route));

const resultsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "results",
  validateSearch: (search) => resultsSearchSchema.parse(search),
  loaderDeps: ({ search }) => search,
  loader: async ({ context, deps }) => {
    const session = await requireTeachingSession(context.queryClient);
    const availableSubjects = session.workspaceSubjects.filter((subject) => subject.permissions.includes("view_results"));
    const requested = availableSubjects.find((subject) => subject.id === deps.subjectId);
    const selected = requested ?? availableSubjects[0] ?? null;
    if (selected && deps.subjectId !== selected.id) {
      throw redirect({ to: "/results", search: { ...deps, subjectId: selected.id }, replace: true });
    }
    return { session, subjectId: selected?.id ?? null };
  },
  pendingComponent: () => <main className="routeState"><PageSkeleton rows={8} /></main>,
}).lazy(() => import("../../features/results/routes/results.lazy.tsx").then((module) => module.Route));

const accountsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "accounts",
  validateSearch: (search) => accountsSearchSchema.parse(search),
  loaderDeps: ({ search }) => search,
  loader: async ({ context, deps }) => {
    const session = await requireAdminSession(context.queryClient, true);
    if (!session.navigation.some((item) => item.key === "accounts" && item.permission === "manage_accounts")) {
      throw redirect({ to: "/dashboard", search: {}, replace: true });
    }
    await Promise.all([
      context.queryClient.prefetchQuery(accountPageQueryOptions(deps.page ?? 1, 20)),
      context.queryClient.prefetchQuery(managedSubjectQueryOptions()),
    ]);
    return { session };
  },
  pendingComponent: () => <main className="routeState"><PageSkeleton rows={8} /></main>,
}).lazy(() => import("../../features/accounts/routes/accounts.lazy.tsx").then((module) => module.Route));

const routeTree = rootRoute.addChildren([loginRoute, systemRoute, subjectsRoute, dashboardRoute, authoringRoute, examsRoute, examRoomRoute, resultsRoute, accountsRoute]);

export const router = createRouter({
  basepath: "/admin",
  context: { queryClient },
  defaultPreload: "intent",
  routeTree,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
