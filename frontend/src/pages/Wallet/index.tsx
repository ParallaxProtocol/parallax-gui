import { useT } from "../../i18n";
import { PageStagger, StaggerItem } from "../../components/PageStagger";
import { SectionHeader } from "../../components/ui/SectionHeader";
import Connection from "./Connection";
import Watched from "./Watched";

export default function WalletPage() {
  const t = useT();
  return (
    <PageStagger className="flex flex-col gap-10">
      <StaggerItem className="flex flex-col gap-4">
        <SectionHeader index={1} title={t("wallet.section.connection")} />
        <Connection />
      </StaggerItem>
      <StaggerItem className="flex flex-col gap-4">
        <SectionHeader index={2} title={t("wallet.section.watched")} aside={t("wallet.section.watchedAside")} />
        <Watched />
      </StaggerItem>
    </PageStagger>
  );
}
