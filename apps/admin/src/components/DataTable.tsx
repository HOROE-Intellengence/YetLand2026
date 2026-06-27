import type { ReactNode } from 'react';

export interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => ReactNode;
  mono?: boolean;
  width?: number | string;
}

interface Props<T> {
  columns: Column<T>[];
  rows: T[];
  emptyMessage?: string;
  rowKey?: (row: T, index: number) => string;
}

export function DataTable<T>({
  columns,
  rows,
  emptyMessage = '暂无数据',
  rowKey,
}: Props<T>) {
  return (
    <div className="card" style={{ padding: 0 }}>
      <table>
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key} style={col.width ? { width: col.width } : undefined}>{col.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} style={{ color: 'var(--paper-mute)' }}>{emptyMessage}</td>
            </tr>
          ) : (
            rows.map((row, i) => (
              <tr key={rowKey ? rowKey(row, i) : i}>
                {columns.map((col) => {
                  const content = col.render ? col.render(row) : String((row as Record<string, unknown>)[col.key] ?? '');
                  return (
                    <td key={col.key} style={col.mono ? { fontFamily: 'var(--font-mono)', fontSize: 11 } : undefined}>
                      {content}
                    </td>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
