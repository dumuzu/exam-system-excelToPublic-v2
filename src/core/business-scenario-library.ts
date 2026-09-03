export const BUSINESS_FIELDS = Object.freeze(["Code", "Name", "Group", "Value", "Qty", "Text", "Status", "Mixed", "Date"] as const);
export type BusinessField = typeof BUSINESS_FIELDS[number];

export interface BusinessRow extends Record<BusinessField, string | number | null> {
  Code: string;
  Name: string;
  Group: string;
  Value: number;
  Qty: number;
  Text: string;
  Status: string;
  Mixed: string | null;
  Date: string;
}

export interface BusinessDataset {
  readonly key: string;
  readonly title: string;
  readonly labels: Readonly<Record<BusinessField, string>>;
  readonly values: number[];
  readonly quantities: number[];
  readonly dates: string[];
  readonly rows: BusinessRow[];
  readonly targetGroup: string;
  readonly targetStatus: string;
}

const BUSINESS_SCENARIOS = Object.freeze([
  {
    key: "sales-orders",
    title: "Sales orders",
    labels: { Code: "Order ID", Name: "Product", Group: "Region", Value: "Sales", Qty: "Quantity", Text: "Reference", Status: "Order Status", Mixed: "Note", Date: "Order Date" },
    codes: ["ORD-101", "ORD-102", "ORD-103", "ORD-104", "ORD-105"],
    names: ["Laptop", "Desk", "Monitor", "Chair", "Printer"],
    groups: ["East", "West"],
    statuses: ["Open", "Closed"],
    texts: ["tokyo-east", "osaka-west", "kobe-north", "kyoto-south", "nara-center"],
  },
  {
    key: "inventory-control",
    title: "Inventory control",
    labels: { Code: "Item ID", Name: "Item", Group: "Category", Value: "Stock", Qty: "Pack Size", Text: "SKU", Status: "Availability", Mixed: "Note", Date: "Received Date" },
    codes: ["ITM-201", "ITM-202", "ITM-203", "ITM-204", "ITM-205"],
    names: ["Cable", "Mouse", "Paper", "Toner", "Keyboard"],
    groups: ["Hardware", "Office"],
    statuses: ["Available", "On Hold"],
    texts: ["cable-blue", "mouse-black", "paper-white", "toner-cyan", "keybd-slim"],
  },
  {
    key: "staff-performance",
    title: "Staff performance",
    labels: { Code: "Employee ID", Name: "Employee", Group: "Department", Value: "Score", Qty: "Attendance", Text: "Account", Status: "Employment", Mixed: "Remark", Date: "Start Date" },
    codes: ["EMP-301", "EMP-302", "EMP-303", "EMP-304", "EMP-305"],
    names: ["amaya", "bimal", "chandra", "dilani", "ekraj"],
    groups: ["Sales", "Support"],
    statuses: ["Active", "Leave"],
    texts: ["amaya-east", "bimal-west", "chandra-it", "dilani-hr", "ekraj-admin"],
  },
  {
    key: "delivery-operations",
    title: "Delivery operations",
    labels: { Code: "Shipment ID", Name: "Destination", Group: "Route", Value: "Cost", Qty: "Boxes", Text: "Tracking", Status: "Delivery Status", Mixed: "Note", Date: "Ship Date" },
    codes: ["SHP-401", "SHP-402", "SHP-403", "SHP-404", "SHP-405"],
    names: ["Tokyo", "Osaka", "Kobe", "Kyoto", "Nara"],
    groups: ["Priority", "Standard"],
    statuses: ["In Transit", "Delivered"],
    texts: ["tokyo-fast", "osaka-west", "kobe-north", "kyoto-next", "nara-local"],
  },
  {
    key: "customer-accounts",
    title: "Customer accounts",
    labels: { Code: "Account ID", Name: "Customer", Group: "Segment", Value: "Balance", Qty: "Orders", Text: "Contact Code", Status: "Account Status", Mixed: "Note", Date: "Open Date" },
    codes: ["ACC-501", "ACC-502", "ACC-503", "ACC-504", "ACC-505"],
    names: ["alpha co", "bravo ltd", "charlie shop", "delta inc", "echo mart"],
    groups: ["Retail", "Business"],
    statuses: ["Active", "Inactive"],
    texts: ["alpha-east", "bravo-west", "charlie-nr", "delta-main", "echo-local"],
  },
]);

export function createBusinessDataset({ random, offset = 0 }: { random: () => number; offset?: number }): BusinessDataset {
  const scenario = BUSINESS_SCENARIOS[Math.floor(random() * BUSINESS_SCENARIOS.length)] ?? BUSINESS_SCENARIOS[0]!;
  const values = [12, 25, 8, 40, 15].map((value) => value + offset);
  const quantities = [2, 3, 4, 1, 5];
  const dates = ["2026-01-15", "2026-03-08", "2026-07-13", "2026-10-21", "2026-12-05"];
  const rows: BusinessRow[] = values.map((value, index) => ({
    Code: scenario.codes[index] ?? "",
    Name: scenario.names[index] ?? "",
    Group: scenario.groups[index % 2 === 0 ? 0 : 1] ?? "",
    Value: value,
    Qty: quantities[index] ?? 0,
    Text: scenario.texts[index] ?? "",
    Status: scenario.statuses[index === 1 || index === 4 ? 1 : 0] ?? "",
    Mixed: index === 0 ? String(value) : index === 2 ? "x" : index === 4 ? "5" : null,
    Date: dates[index] ?? "",
  }));
  return {
    key: scenario.key,
    title: scenario.title,
    labels: scenario.labels,
    values,
    quantities,
    dates,
    rows,
    targetGroup: scenario.groups[0] ?? "",
    targetStatus: scenario.statuses[0] ?? "",
  };
}

export function createDisplayTable(dataset: BusinessDataset, shuffledFields: readonly BusinessField[]) {
  const columns = shuffledFields.map((field) => dataset.labels[field]);
  const rows = dataset.rows.map((row) => Object.fromEntries(
    shuffledFields.map((field) => [dataset.labels[field], row[field]]),
  ));
  return { columns, rows };
}

export function contextualizeBusinessPrompt(prompt: string, labels: Readonly<Record<BusinessField, string>>): string {
  return BUSINESS_FIELDS.reduce(
    (result, field) => result.replaceAll(field, labels[field]),
    prompt,
  );
}

export function listBusinessScenarioKeys() {
  return BUSINESS_SCENARIOS.map((scenario) => scenario.key);
}
