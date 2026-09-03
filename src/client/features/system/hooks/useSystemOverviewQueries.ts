import { useQuery } from "@tanstack/react-query";

import { accountPageQueryOptions, managedSubjectQueryOptions } from "../../accounts/api/accountQueries.ts";
import { platformExamEventQueryOptions } from "../api/systemQueries.ts";

export function useSystemOverviewQueries() {
  const accountQuery = useQuery(accountPageQueryOptions(1, 1));
  const subjectQuery = useQuery(managedSubjectQueryOptions());
  const examQuery = useQuery(platformExamEventQueryOptions());

  return {
    accountTotal: accountQuery.data?.pagination.total ?? 0,
    exams: examQuery.data ?? [],
    failed: accountQuery.isError || subjectQuery.isError || examQuery.isError,
    loading: accountQuery.isLoading || subjectQuery.isLoading || examQuery.isLoading,
    refreshing: accountQuery.isFetching || subjectQuery.isFetching || examQuery.isFetching,
    retry: async () => {
      await Promise.all([accountQuery.refetch(), subjectQuery.refetch(), examQuery.refetch()]);
    },
    subjects: subjectQuery.data ?? [],
  };
}
