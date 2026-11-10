import { beforeEach, expect, jest, test } from "@jest/globals";

// First: it mocks Reanimated before any screen module loads it.
import "../../theme/mock-reanimated";

import { PORTRAIT_SIZE, resizePortrait } from "../../../src/features/party/portrait";

const mockResize = jest.fn();
const mockSave = jest.fn((_options: unknown) => Promise.resolve({ uri: "file:///small.jpg", width: 512, height: 512 }));

jest.mock("expo-image-manipulator", () => ({
  SaveFormat: { JPEG: "jpeg", PNG: "png", WEBP: "webp" },
  ImageManipulator: {
    manipulate: () => {
      const context = {
        resize: (size: unknown) => {
          mockResize(size);
          return context;
        },
        renderAsync: () => Promise.resolve({ saveAsync: mockSave }),
      };
      return context;
    },
  },
}));

beforeEach(() => {
  mockResize.mockReset();
  mockSave.mockClear();
});

test("a large picked portrait is shrunk to 512 px and re-encoded as JPEG before the upload", async () => {
  await expect(resizePortrait({ uri: "file:///big.png", width: 3024 })).resolves.toEqual({ uri: "file:///small.jpg", type: "image/jpeg" });
  expect(mockResize).toHaveBeenCalledWith({ width: PORTRAIT_SIZE });
  expect(mockSave).toHaveBeenCalledWith({ compress: 0.8, format: "jpeg" });
});

test("a small portrait is re-encoded but never enlarged", async () => {
  await resizePortrait({ uri: "file:///tiny.png", width: 200 });
  expect(mockResize).not.toHaveBeenCalled();
  expect(mockSave).toHaveBeenCalled();
});
