import * as ort from "onnxruntime-web";
import Jimp from "jimp";
import { ImageProcessingResult } from "./interfaces";
import { BaseImageModel } from "./base";

/**
 * Output of the image-to-image model.
 *
 * @param data - array buffer with the resulting image.
 */
export type Img2ImgResult = ImageProcessingResult & {
  data: ImageData;
};

/**
 * Model for generating images from images.
 *
 * @implements IImageModel
 *
 * @remarks
 * The model is initialized via `init()` function. The model cannot be used if it is not initialized.
 *
 * @param metadata - information about the model.
 * @param initialized - flag indicating if the model was initialized.
 */
export class Img2ImgModel extends BaseImageModel {
  /**
   * Processes the image and generates the image from the input.
   *
   * @param input - either URL to the image or Buffer with the image.
   *
   * @returns generated image.
   */
  process = async (input: string | ArrayBuffer, resize = 0): Promise<Img2ImgResult> => {
    if (!this.initialized || !this.preprocessor) {
      throw Error("the model is not initialized");
    }
    // @ts-ignore
    let image = await Jimp.read(input);
    if (resize > 0) {
      image = this.prepareImage(image, resize);
    }
    const tensor = this.preprocessor.process(image);
    const start = new Date();
    const output = await this.runInference(tensor);
    const end = new Date();
    const elapsed = (end.getTime() - start.getTime()) / 1000;
    let startX = 0;
    let startY = 0;
    let endX = output.dims[3];
    let endY = output.dims[2];
    if (this.preprocessor && this.preprocessor.config && this.preprocessor.config.pad) {
      const padSize = this.preprocessor.config.padSize;
      const paddedWidth = Math.ceil(image.bitmap.width / padSize) * padSize;
      const xDiff = paddedWidth - image.bitmap.width;
      const paddedHeight = Math.ceil(image.bitmap.height / padSize) * padSize;
      const yDiff = paddedHeight - image.bitmap.height;
      const xRatio = output.dims[3] / paddedWidth;
      const yRatio = output.dims[2] / paddedHeight;
      const xPad = Math.floor((xDiff * xRatio) / 2);
      const yPad = Math.floor((yDiff * yRatio) / 2);
      startX = xPad;
      startY = yPad;
      endX = Math.ceil(output.dims[3] - xPad);
      endY = Math.ceil(output.dims[2] - yPad);
    }
    const width = endX - startX;
    const height = endY - startY;
    const size = output.dims[2] * output.dims[3];
    const arrayBuffer = new ArrayBuffer(width * height * 4);
    const pixels = new Uint8ClampedArray(arrayBuffer);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const pixIdx = 4 * (y * width + x);
        const tensorIdx = (y + startY) * output.dims[3] + x + startX;
        let value = output.data[tensorIdx] as number;
        if (value < 0) {
          value = 0;
        } else {
          if (value > 1) {
            value = 1;
          }
        }
        value *= 255.0;
        pixels[pixIdx] = value;

        value = output.data[size + tensorIdx] as number;
        if (value < 0) {
          value = 0;
        } else {
          if (value > 1) {
            value = 1;
          }
        }
        value *= 255.0;
        pixels[pixIdx + 1] = value;

        value = output.data[2 * size + tensorIdx] as number;
        if (value < 0) {
          value = 0;
        } else {
          if (value > 1) {
            value = 1;
          }
        }
        value *= 255.0;
        pixels[pixIdx + 2] = value;
        pixels[pixIdx + 3] = 255;
      }
    }
    const imageData = new ImageData(pixels, width, height);
    return {
      data: imageData,
      elapsed: elapsed,
    };
  };

  private prepareImage = (image: Jimp, resize: number): Jimp => {
    const { width, height } = image.bitmap;
    const maxDimension = Math.max(width, height);
    if (maxDimension > resize) {
      const scale = resize / maxDimension;
      const newWidth = width * scale;
      const newHeight = height * scale;
      return image.resize(newWidth, newHeight);
    }
    return image;
  };

  private runInference = async (input: ort.Tensor): Promise<ort.Tensor> => {
    if (!this.initialized || !this.sessions) {
      throw Error("the model is not initialized");
    }
    const session = this.sessions.get("model");
    if (!session) {
      throw Error("the model is absent in the sessions map");
    }
    const feeds: Record<string, ort.Tensor> = {};
    const inputNames = await session.inputNames();
    feeds[inputNames[0]] = input;
    const outputData = await session.run(feeds);
    const outputNames = await session.outputNames();
    const output = outputData[outputNames[0]];
    return output;
  };
}
