const SAFE_POSTGRES_PARAMETER_LIMIT = 60_000;

export function chunkRowsForPostgres<Row>(rows: readonly Row[], { parametersPerRow }: { parametersPerRow: number }): Row[][] {
  if (!Number.isInteger(parametersPerRow) || parametersPerRow <= 0) {
    throw new TypeError("parametersPerRow must be a positive integer");
  }

  const maximumRowsPerStatement = Math.floor(SAFE_POSTGRES_PARAMETER_LIMIT / parametersPerRow);
  const chunks: Row[][] = [];
  for (let offset = 0; offset < rows.length; offset += maximumRowsPerStatement) {
    chunks.push(rows.slice(offset, offset + maximumRowsPerStatement));
  }
  return chunks;
}
