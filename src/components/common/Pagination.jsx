/**
 * Small client-side pagination control for admin tables.
 * Renders "Prev / page numbers / Next" and is a no-op when there is only
 * one page.
 */
export function Pagination({ page, pageCount, onChange }) {
  if (pageCount <= 1) return null;
  const numbers = [];
  for (let index = 1; index <= pageCount; index += 1) numbers.push(index);
  return (
    <nav className="pagination" aria-label="Table pagination">
      <button
        type="button"
        className="button outline"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}>
        &larr; Prev
      </button>
      <div className="pagination-pages">
        {numbers.map((number) => (
          <button
            key={number}
            type="button"
            className={`page-number ${number === page ? "active" : ""}`}
            aria-current={number === page ? "page" : undefined}
            onClick={() => onChange(number)}>
            {number}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="button outline"
        disabled={page >= pageCount}
        onClick={() => onChange(page + 1)}>
        Next &rarr;
      </button>
    </nav>
  );
}