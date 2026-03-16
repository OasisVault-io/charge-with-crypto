import { useEffect, useState } from 'react';

import { defaultMerchantLogo } from './dashboard.shared';

type DashboardLogoImageProps = {
  alt: string;
  src: string;
  className?: string;
};

export function DashboardLogoImage({ alt, src, className }: DashboardLogoImageProps) {
  const [currentSrc, setCurrentSrc] = useState(src || defaultMerchantLogo);

  useEffect(() => {
    setCurrentSrc(src || defaultMerchantLogo);
  }, [src]);

  return (
    <img
      alt={alt}
      className={className}
      src={currentSrc}
      onError={() => setCurrentSrc(defaultMerchantLogo)}
    />
  );
}

