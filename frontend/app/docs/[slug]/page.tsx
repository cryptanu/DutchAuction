import Link from "next/link";
import { notFound } from "next/navigation";
import { getDocBySlug, getDocNeighbors, getDocsNavigation } from "~~/lib/docs/content";
import { extractTocHeadings, renderMarkdownToHtml } from "~~/lib/docs/markdown";

type DocRouteProps = {
  params: Promise<{ slug: string }>;
};

export const generateStaticParams = () => {
  return getDocsNavigation().map(doc => ({ slug: doc.slug }));
};

const DocsPage = async (props: DocRouteProps) => {
  const params = await props.params;
  const doc = await getDocBySlug(params.slug);

  if (!doc) {
    notFound();
  }

  const navItems = getDocsNavigation();
  const tocItems = extractTocHeadings(doc.markdown);
  const html = renderMarkdownToHtml(doc.markdown);
  const neighbors = getDocNeighbors(doc.slug);

  return (
    <div className="bg-[#f8fafc]">
      <div className="mx-auto w-full max-w-[1380px] px-4 py-8 lg:px-8 lg:py-10">
        <section className="mb-6 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm lg:px-6">
          <p className="m-0 text-[11px] uppercase tracking-[0.08em] text-slate-500">Stealth Dutch Auction Docs</p>
          <h1 className="m-0 mt-2 text-[28px] font-semibold tracking-[-0.02em] text-slate-950">Developer Docs</h1>
          <p className="mb-0 mt-2 max-w-3xl text-[15px] leading-7 text-slate-600">
            Integration-first documentation for launchpads using the Dutch Auction hook + SDK stack on Base Sepolia.
          </p>
        </section>

        <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[260px_minmax(0,1fr)_220px]">
          <aside className="hidden lg:block">
            <div className="sticky top-24 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="m-0 text-[12px] font-semibold uppercase tracking-[0.08em] text-slate-500">Contents</p>
              <nav className="mt-3 space-y-1">
                {navItems.map(item => {
                  const active = item.slug === doc.slug;
                  return (
                    <Link
                      key={item.slug}
                      href={`/docs/${item.slug}`}
                      className={`block rounded-lg px-3 py-2 text-[14px] leading-[1.35] transition ${
                        active
                          ? "bg-[#3b8bff]/10 text-[#225dcb] shadow-[0_1px_0_1px_rgba(59,139,255,0.18)]"
                          : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                      }`}
                    >
                      {item.title}
                    </Link>
                  );
                })}
              </nav>
            </div>
          </aside>

          <article className="rounded-2xl border border-slate-200 bg-white px-6 py-7 shadow-sm lg:px-10 lg:py-9">
            <p className="m-0 text-[11px] uppercase tracking-[0.08em] text-slate-500">Documentation</p>
            <h2 className="m-0 mt-2 text-[34px] font-semibold leading-[1.15] tracking-[-0.03em] text-slate-950">
              {doc.title}
            </h2>
            <p className="mb-0 mt-2 text-[16px] leading-7 text-slate-600">{doc.description}</p>

            <div
              className="mt-7 border-t border-slate-100 pt-2 [&_h1:first-child]:mt-0"
              dangerouslySetInnerHTML={{ __html: html }}
            />

            <div className="mt-10 grid gap-3 border-t border-slate-200 pt-6 sm:grid-cols-2">
              {neighbors.previous ? (
                <Link
                  href={`/docs/${neighbors.previous.slug}`}
                  className="group rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 transition hover:border-slate-300 hover:bg-slate-100"
                >
                  <p className="m-0 text-[12px] uppercase tracking-[0.06em] text-slate-500">Previous</p>
                  <p className="mb-0 mt-1 text-[15px] font-medium text-slate-800 group-hover:text-slate-950">
                    {neighbors.previous.title}
                  </p>
                </Link>
              ) : (
                <div />
              )}

              {neighbors.next ? (
                <Link
                  href={`/docs/${neighbors.next.slug}`}
                  className="group rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-right transition hover:border-slate-300 hover:bg-slate-100"
                >
                  <p className="m-0 text-[12px] uppercase tracking-[0.06em] text-slate-500">Next</p>
                  <p className="mb-0 mt-1 text-[15px] font-medium text-slate-800 group-hover:text-slate-950">
                    {neighbors.next.title}
                  </p>
                </Link>
              ) : (
                <div />
              )}
            </div>
          </article>

          <aside className="hidden xl:block">
            <div className="sticky top-24 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="m-0 text-[12px] font-semibold uppercase tracking-[0.08em] text-slate-500">On this page</p>
              {tocItems.length === 0 ? (
                <p className="mb-0 mt-3 text-[13px] text-slate-500">No section headings.</p>
              ) : (
                <nav className="mt-3 space-y-1">
                  {tocItems.map(heading => (
                    <a
                      key={heading.id}
                      href={`#${heading.id}`}
                      className={`block rounded-md px-2 py-1.5 text-[13px] text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 ${
                        heading.level === 3 ? "ml-3" : ""
                      }`}
                    >
                      {heading.text}
                    </a>
                  ))}
                </nav>
              )}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
};

export default DocsPage;
