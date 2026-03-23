import { getMetadata } from "~~/utils/scaffold-eth/getMetadata";

export const metadata = getMetadata({
  title: "Docs",
  description: "Integration docs for the Stealth Dutch Auction SDK and hook contracts.",
});

const DocsLayout = ({ children }: { children: React.ReactNode }) => {
  return <>{children}</>;
};

export default DocsLayout;
