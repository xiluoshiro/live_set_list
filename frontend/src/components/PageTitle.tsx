type PageTitleProps = {
  kicker: string;
  title: string;
  description?: string;
  id?: string;
};

export function PageTitle({ kicker, title, description, id }: PageTitleProps) {
  return (
    <div className="page-title">
      <p className="page-title-kicker">{kicker}</p>
      <h1 id={id}>{title}</h1>
      {description && <p className="page-title-description">{description}</p>}
    </div>
  );
}
