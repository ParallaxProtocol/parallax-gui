import { useT } from "../../i18n";
import Connection from "./Connection";
import Watched from "./Watched";

export default function WalletPage() {
  const t = useT();
  return (
    <div className="flex flex-col gap-6 p-5">
      <Connection />
      <Watched title={t("wallet.section.watched")} />
    </div>
  );
}
