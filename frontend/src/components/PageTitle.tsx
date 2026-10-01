type PageTitleProps = {
  title: string;
  id?: string;
};

export function PageTitle({ title, id }: PageTitleProps) {
  return (
    <div className="page-title">
      <h1 id={id}>{title}</h1>
    </div>
  );
}
