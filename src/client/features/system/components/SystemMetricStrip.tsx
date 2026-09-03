interface SystemMetrics {
  accounts: number;
  subjects: number;
  activeRooms: number;
  submissions: number;
}

export function SystemMetricStrip({ ariaLabel, labels, metrics }: {
  ariaLabel: string;
  labels: { accounts: string; subjects: string; activeRooms: string; submissions: string };
  metrics: SystemMetrics;
}) {
  const entries = [
    { key: "accounts", label: labels.accounts, value: metrics.accounts },
    { key: "subjects", label: labels.subjects, value: metrics.subjects },
    { key: "activeRooms", label: labels.activeRooms, value: metrics.activeRooms },
    { key: "submissions", label: labels.submissions, value: metrics.submissions },
  ] as const;

  return (
    <dl aria-label={ariaLabel} className="systemMetricStrip">
      {entries.map((entry) => (
        <div key={entry.key}>
          <dt>{entry.label}</dt>
          <dd>{entry.value.toLocaleString()}</dd>
        </div>
      ))}
    </dl>
  );
}
