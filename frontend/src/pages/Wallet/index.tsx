import { useT } from "../../i18n";
import Watched from "./Watched";

/** WalletPage is the app's landing page: the watched address, its balance and activity. */
export default function WalletPage() {
  const t = useT();
  return (
    <div className="flex flex-col gap-6 p-5">
      <Watched title={t("wallet.section.watched")} />
    </div>
  );
}
