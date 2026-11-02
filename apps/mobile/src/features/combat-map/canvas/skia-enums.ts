/**
 * Numeric enum values from `@shopify/react-native-skia` 2.14.0.
 * The web bindings map these numbers onto CanvasKit enums by value.
 */
export const PaintStyle = { Fill: 0, Stroke: 1 } as const;
export const StrokeCap = { Butt: 0, Round: 1, Square: 2 } as const;
export const StrokeJoin = { Miter: 0, Round: 1, Bevel: 2 } as const;
export const ClipOp = { Difference: 0, Intersect: 1 } as const;
export const BlendMode = { Src: 1, SrcOver: 3 } as const;
export const TileMode = { Clamp: 0 } as const;
export const AlphaType = { Unpremul: 3 } as const;
export const ColorType = { RGBA_8888: 4 } as const;
export const FilterMode = { Nearest: 0, Linear: 1 } as const;
export const MipmapMode = { None: 0 } as const;
