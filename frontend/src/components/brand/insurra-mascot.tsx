import Image from "next/image";

const mascotAssets = {
  assistant: {
    src: "/mascot-bubble.png",
    alt: "INSSURA assistant mascot",
  },
  shield: {
    src: "/Winking Kangaroo Shield Mascot.png",
    alt: "INSSURA protection mascot",
  },
  document: {
    src: "/Winking Kangaroo Mascot with Document.png",
    alt: "INSSURA document mascot",
  },
  checklist: {
    src: "/Cute Mascot with Checklist Clipboard.png",
    alt: "INSSURA checklist mascot",
  },
} as const;

type MascotVariant = keyof typeof mascotAssets;

export function InsurraMascot({
  variant = "assistant",
  size,
  className,
  decorative = false,
  priority = false,
}: {
  variant?: MascotVariant;
  size: number;
  className?: string;
  decorative?: boolean;
  priority?: boolean;
}) {
  const asset = mascotAssets[variant];

  return (
    <Image
      src={asset.src}
      alt={decorative ? "" : asset.alt}
      width={size}
      height={size}
      className={className}
      priority={priority}
      style={{ objectFit: "contain" }}
    />
  );
}

export const InssuraMascot = InsurraMascot;
