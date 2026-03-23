import { redirect } from "next/navigation";
import { getDocsNavigation } from "~~/lib/docs/content";

const DocsLandingPage = () => {
  const firstDoc = getDocsNavigation()[0];
  redirect(`/docs/${firstDoc.slug}`);
};

export default DocsLandingPage;
