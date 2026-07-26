export function downloadBatchCsvTemplate(
  columns: string[],
  template: "batch" | "payroll",
): void {
  if (typeof window === "undefined") return;
  const header =
    columns.length > 0
      ? columns
      : ["name", "address", "asset", "amount", "note"];
  const sample =
    template === "payroll"
      ? ["Teammate", "SOLANA_ADDRESS", "SOL", "0.25", "Payroll"]
      : ["Vendor", "SOLANA_ADDRESS", "SOL", "0.25", "Invoice"];
  const csv = [
    header.join(","),
    sample.slice(0, header.length).join(","),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `clearsig-${template}-template.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
