declare module 'dom-to-image-more' {
  export interface Options {
    filter?: (node: Node) => boolean
    bgcolor?: string
    width?: number
    height?: number
    style?: Record<string, string>
    quality?: number
    imagePlaceholder?: string
    cacheBust?: boolean
    copyDefaultStyles?: boolean
    useCORS?: boolean
    allowTaint?: boolean
    scale?: number
    pixelRatio?: number
  }

  export function toPng(node: HTMLElement, options?: Options): Promise<string>
  export function toJpeg(node: HTMLElement, options?: Options): Promise<string>
  export function toBlob(node: HTMLElement, options?: Options): Promise<Blob>
  export function toPixelData(node: HTMLElement, options?: Options): Promise<Uint8Array>
  export function toSvg(node: HTMLElement, options?: Options): Promise<string>
  export function toCanvas(node: HTMLElement, options?: Options): Promise<HTMLCanvasElement>

  const domtoimage: {
    toPng: typeof toPng
    toJpeg: typeof toJpeg
    toBlob: typeof toBlob
    toPixelData: typeof toPixelData
    toSvg: typeof toSvg
    toCanvas: typeof toCanvas
  }

  export default domtoimage
}

