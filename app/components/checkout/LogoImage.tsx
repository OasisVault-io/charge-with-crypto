import { defaultMerchantLogo } from './checkout.shared'

type LogoImageProps = {
  alt: string
  className: string
  src: string
  setLogoSrc: (value: string) => void
}

export function LogoImage({ alt, className, src, setLogoSrc }: LogoImageProps) {
  return (
    <img
      alt={alt}
      className={className}
      src={src}
      onError={() => setLogoSrc(defaultMerchantLogo)}
    />
  )
}
