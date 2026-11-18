import React from "react";
import {
  Archive,
  Bookmark,
  Disc,
  Film,
  Flame,
  Folder,
  Gamepad2,
  Headphones,
  Heart,
  Layers,
  Music,
  Radio,
  Shield,
  Sparkles,
  Zap,
} from "lucide-react";

interface CollectionIconProps {
  icon?: string;
  className?: string;
  style?: React.CSSProperties;
}

export const CollectionIcon: React.FC<CollectionIconProps> = ({
  icon = "layers",
  className = "w-3.5 h-3.5 shrink-0",
  style,
}) => {
  switch (icon) {
    case "folder":
      return <Folder className={className} style={style} />;
    case "disc":
      return <Disc className={className} style={style} />;
    case "music":
      return <Music className={className} style={style} />;
    case "film":
      return <Film className={className} style={style} />;
    case "flame":
      return <Flame className={className} style={style} />;
    case "sparkles":
      return <Sparkles className={className} style={style} />;
    case "radio":
      return <Radio className={className} style={style} />;
    case "headphones":
      return <Headphones className={className} style={style} />;
    case "zap":
      return <Zap className={className} style={style} />;
    case "bookmark":
      return <Bookmark className={className} style={style} />;
    case "archive":
      return <Archive className={className} style={style} />;
    case "gamepad":
      return <Gamepad2 className={className} style={style} />;
    case "shield":
      return <Shield className={className} style={style} />;
    case "heart":
      return <Heart className={className} style={style} />;
    case "layers":
    default:
      return <Layers className={className} style={style} />;
  }
};
