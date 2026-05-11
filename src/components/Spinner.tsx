type SpinnerProps = {
  size?: number;
  label?: string;
};

function Spinner({ size = 14, label = '로딩 중' }: SpinnerProps) {
  return (
    <span
      aria-label={label}
      className="spinner"
      role="status"
      style={{ width: size, height: size }}
    />
  );
}

export default Spinner;
