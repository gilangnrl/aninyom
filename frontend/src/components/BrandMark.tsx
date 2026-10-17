import React from "react";
import logoUrl from "../assets/aninyom-logo-nav.png";

interface BrandMarkProps {
  className?: string;
}

export const BrandMark: React.FC<BrandMarkProps> = ({ className = "" }) => (
  <span className={`brand-mark ${className}`.trim()} aria-hidden="true">
    <img src={logoUrl} alt="" width={44} height={36} decoding="async" />
  </span>
);
