type Option<T> = { value: T; label: string };
export function TweakSelect<T extends string>({
  label, value, onChange, options,
}: { label: string; value: T; onChange: (v: T) => void; options: Option<T>[] }) {
  void label; void value; void onChange; void options;
  return null;
}
