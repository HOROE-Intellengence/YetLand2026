interface Props {
  data: unknown;
  maxHeight?: number;
}

export function JsonViewer({ data, maxHeight = 400 }: Props) {
  return (
    <pre
      style={{
        whiteSpace: 'pre-wrap',
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
        maxHeight,
        overflow: 'auto',
        color: 'var(--paper)',
        background: 'rgba(0,0,0,0.2)',
        padding: 12,
        borderRadius: 8,
        margin: 0,
      }}
    >
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}
