import FinanceWorkspace from "@/workspace/FinanceWorkspace";
export default function Finance(_props: { onNavigateToPayouts?: () => void }) {
  return (
    <div className="ws-page">
      <div className="ws-page-heading">
        <div>
          <p className="ws-eyebrow">НАРАХУВАННЯ · ОПЛАТИ · БОРГ</p>
          <h1>Фінанси</h1>
        </div>
      </div>
      <FinanceWorkspace />
    </div>
  );
}
