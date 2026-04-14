import React from "react";

interface LoadingSpinnerProps {
  size?: number;
  message?: string;
}

export default function LoadingSpinner({
  size = 40,
  message,
}: LoadingSpinnerProps): React.ReactElement {
  return (
    <div className="spinner-container">
      <div
        className="spinner"
        style={{ width: size, height: size }}
        role="status"
        aria-label="Loading"
      />
      {message && <p className="spinner-message">{message}</p>}
    </div>
  );
}
