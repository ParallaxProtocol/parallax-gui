import Connection from "./Connection";

/** ConnectPage walks a wallet like MetaMask onto the local node. */
export default function ConnectPage() {
  return (
    <div className="flex flex-col gap-6 p-5">
      <Connection />
    </div>
  );
}
