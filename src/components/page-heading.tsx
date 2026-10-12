export function PageHeading({
  eyebrow = "Your workspace",
  title,
  description,
}: {
  eyebrow?: string;
  title: string;
  description: string;
}) {
  return (
    <div className="space-y-3">
      <p className="eyebrow">{eyebrow}</p>
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
        {title}
      </h1>
      <p className="max-w-2xl leading-7 text-muted-foreground">{description}</p>
    </div>
  );
}
