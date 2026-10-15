import { notFound } from "next/navigation";
export default async function SectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  await params;
  notFound();
}
