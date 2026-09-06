import { Link } from "react-router-dom";

export function Button({ children, variant = "primary", ...props }) {
  const className = `button ${variant === "outline" ? "outline" : ""}`;
  if (props.to)
    return (
      <Link className={className} {...props}>
        {children}
      </Link>
    );
  return (
    <button className={className} {...props}>
      {children}
    </button>
  );
}
