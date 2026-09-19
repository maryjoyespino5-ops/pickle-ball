import { useEffect, useRef } from "react";
import QRCode from "qrcode";

/**
 * Renders a paddle QR code onto a canvas so it works in the admin table, the
 * print sheet, and can be downloaded as a PNG (`canvasStore` collects the
 * finished canvas for the PNG download helper). The encoded value is always
 * just the paddle's public URL (/paddle/:qr_token) — never customer or
 * rental state.
 */
export function QrCode({
  value,
  size = 128,
  className = "",
  canvasStore,
  storeKey,
}) {
  const canvasRef = useRef(null);
  useEffect(() => {
    let cancelled = false;
    const canvas = canvasRef.current;
    if (!value || !canvas) return undefined;
    QRCode.toCanvas(
      canvas,
      value,
      {
        width: size,
        margin: 1,
        errorCorrectionLevel: "M",
        color: { dark: "#143b35", light: "#ffffff" },
      },
      (error) => {
        if (error) {
          console.error("QR generation failed", error);
          return;
        }
        if (!cancelled && canvasStore && storeKey) {
          canvasStore.current[storeKey] = canvas;
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [value, size, canvasStore, storeKey]);
  return (
    <canvas
      ref={canvasRef}
      className={className}
      role="img"
      aria-label={value ? `QR code for ${value}` : "QR code"}
    />
  );
}