import FinanceWorkspace from "@/workspace/FinanceWorkspace";
export default function Payouts({
  focusedApplication,
  onClearFocus,
}: {
  focusedApplication?: string;
  onClearFocus?: () => void;
}) {
  return (
    <div className="ws-page">
      <div className="ws-page-heading">
        <h1>Виплати</h1>
      </div>
      <FinanceWorkspace
        key={focusedApplication || "all"}
        fixedApplication={focusedApplication}
        onClearFocus={onClearFocus}
      />
    </div>
  );
}
