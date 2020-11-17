import utils from "utils";
import html2canvas from "html2canvas";

import CommonMixin from "dom/common_mixin";

// Converts an instance of the visible DOM into an array of pixel values.
// Note that it does this both with and without the text visible in order
// to aid in a clean separation of the graphics and text in the final frame
// rendered in the terminal.
export default class extends utils.mixins(CommonMixin) {
  constructor(channel, dimensions, config) {
    super();
    this.channel = channel;
    this.dimensions = dimensions;
    this.config = config;
    this._html_image_compression = this.config["http-server"].jpeg_compression;
    this._screenshot_canvas = document.createElement("canvas");
    this._converter_canvas = document.createElement("canvas");
    this._screenshot_ctx = this._screenshot_canvas.getContext("2d");
    this._converter_ctx = this._converter_canvas.getContext("2d");
  }

  sendFrame() {
    this.__getScaledScreenshot();
    this._sendFrame();
  }

  // With full-block single-glyph font on
  getUnscaledFGPixelAt(x, y) {
    [x, y] = this._convertDOMCoordsToRelative(x, y);
    if (x === null || y === null) {
      return [null, null, null];
    }
    const width = this.dimensions.dom.sub.width;
    const pixel_data_start = parseInt(y * width * 4 + x * 4);
    let fg_rgb = this.pixels_with_text.slice(
      pixel_data_start,
      pixel_data_start + 3
    );
    return [fg_rgb[0], fg_rgb[1], fg_rgb[2]];
  }

  // Without any text showing at all
  getUnscaledBGPixelAt(x, y) {
    [x, y] = this._convertDOMCoordsToRelative(x, y);
    if (x === null || y === null) {
      return [null, null, null];
    }
    const width = this.dimensions.dom.sub.width;
    const pixel_data_start = parseInt(y * width * 4 + x * 4);
    let bg_rgb = this.pixels_without_text.slice(
      pixel_data_start,
      pixel_data_start + 3
    );
    return [bg_rgb[0], bg_rgb[1], bg_rgb[2]];
  }

  getScreenshotWithText(callback) {
    this.logPerformance(() => {
      this._getScreenshotWithText(callback);
    }, "get screenshot with text");
  }

  getScreenshotWithoutText() {
    this.logPerformance(() => {
      this._getScreenshotWithoutText();
    }, "get screenshot without text");
  }

  getOnOffScreenshots(callback) {
    this.getScreenshotWithoutText();
    this.getScreenshotWithText(callback);
  }

  _getScreenshotWithoutText() {
    this.pixels_without_text = this._getScreenshot().data;
    return this.pixels_without_text;
  }

  _getScreenshotWithText(callback) {
    this.showText();
    if (this.config["http-server-mode"]) {
      // It's a little odd that `config['http-server'].render_delay` is named as such
      // and placed here of all places. But the fact is that a delay is needed here
      // *anyway* and extending the delay kills 2 birds with one stone. Firstly solving
      // this tricky little need-to-wait-for-the-font-to-render issue *and* solving the
      // the fact that some pages just don't finish loading at `windows.onload()`.
      setTimeout(() => {
        this._getScreenshotWithTextDelayable(callback);
      }, this.config["http-server"].render_delay);
    } else {
      this._getScreenshotWithTextDelayable(callback);
    }
  }

  // I'm not entirely clear on the reason, but when a Browsh tab's only purpose is
  // to render a single frame (such as in the HTTP service), it needs a few milliseconds
  // to show the text for the first time. My only theory is that at page load some time
  // is needed to parse and render the font.
  // However in normal TTY mode, no such delay is needed, indeed even placing this
  // function inside `setTimeout()` causes oddities.
  _getScreenshotWithTextDelayable(callback) {
    this.pixels_with_text = this._getScreenshot().data;
    this.hideText();
    callback();
  }

  _getScaledScreenshot() {
    this._scaleCanvas();
    this.scaled_pixels_image_object = this._getScreenshot();
    this.scaled_pixels = this.scaled_pixels_image_object.data;
    this._unScaleCanvas();
    return this.scaled_pixels;
  }

  // It's either convert coords to relative in this class or TextBuilder. On balance it
  // seems better to retain TextBuilder's reference in absolute coords, thus somewhat
  // hiding the overhead of relative-to-the-frame coords in public methods.
  _convertDOMCoordsToRelative(x, y) {
    const top = this.dimensions.dom.sub.top;
    const bottom = this.dimensions.dom.sub.top + this.dimensions.dom.sub.height;
    const left = this.dimensions.dom.sub.left;
    const right = this.dimensions.dom.sub.left + this.dimensions.dom.sub.width;
    if (x >= left && x < right) {
      x -= this.dimensions.dom.sub.left;
    } else {
      x = null;
    }
    if (y >= top && y < bottom) {
      y -= this.dimensions.dom.sub.top;
    } else {
      y = null;
    }
    return [x, y];
  }

  // Scaled to the size where each pixel is the same size as a TTY cell
  _getScaledPixelAt(x, y) {
    const width = this.dimensions.frame.sub.width;
    const pixel_data_start = y * width * 4 + x * 4;
    const rgb = this.scaled_pixels.slice(
      pixel_data_start,
      pixel_data_start + 3
    );
    return [rgb[0], rgb[1], rgb[2]];
  }

  __getScaledScreenshot() {
    this.logPerformance(() => {
      this._getScaledScreenshot();
    }, "get scaled screenshot");
  }

  hideText() {
    document.body.classList.remove("browsh-show-text");
    document.body.classList.add("browsh-hide-text");
  }

  showText() {
    document.body.classList.remove("browsh-hide-text");
    document.body.classList.add("browsh-show-text");
  }

  _getScreenshot() {
    return this._getPixelData();
  }

  // Scale the screenshot so that 1 pixel approximates half a TTY cell.
  _scaleCanvas() {
    this._is_scaled = true;
    this._screenshot_ctx.save();
    this._screenshot_ctx.scale(
      this.dimensions.scale_factor.width,
      this.dimensions.scale_factor.height
    );
  }

  _unScaleCanvas() {
    this._screenshot_ctx.restore();
    this._is_scaled = false;
  }

  _updateCanvasSize() {
    if (this._is_scaled) return;
    this._screenshot_canvas.width = this.dimensions.dom.sub.width;
    this._screenshot_canvas.height = this.dimensions.dom.sub.height;
  }

  // Get an array of RGB values.
  // This is Firefox-only. Chrome has a nicer MediaStream for this.
  async _getPixelData() {
    let width, height;
    const background_colour = "rgb(255,255,255)";
    if (this._is_scaled) {
      width = this.dimensions.frame.sub.width;
      height = this.dimensions.frame.sub.height;
    } else {
      width = this.dimensions.dom.sub.width;
      height = this.dimensions.dom.sub.height;
    }
    if (width <= 0 || height <= 0) {
      return [];
    }
    this._updateCanvasSize();
    await html2canvas(document.body, {canvas: this._screenshot_canvas});
/*
    this._screenshot_ctx.drawWindow(
      window,
      this.dimensions.dom.sub.left,
      this.dimensions.dom.sub.top,
      this.dimensions.dom.sub.width,
      this.dimensions.dom.sub.height,
      background_colour
    );
*/
    return this._screenshot_ctx.getImageData(0, 0, width, height);
  }

  // Return the scaled screenshot as a data URI to display in HTML
  _getScaledDataURI() {
    this.__getScaledScreenshot();
    this._converter_canvas.width = this.dimensions.frame.sub.width;
    this._converter_canvas.height = this.dimensions.frame.sub.height;
    this._converter_ctx.putImageData(this.scaled_pixels_image_object, 0, 0);
    return this._converter_canvas.toDataURL(
      "image/jpeg",
      this._html_image_compression
    );
  }

  _sendFrame() {
    this._serialiseFrame();
    if (this.frame.colours.length > 0) {
      this.sendMessage(`/frame_pixels,${JSON.stringify(this.frame)}`);
    } else {
      this.log("Not sending empty pixels frame");
    }
  }

  _serialiseFrame() {
    this._setupFrameMeta();
    const width = this.dimensions.frame.sub.width;
    const height = this.dimensions.frame.sub.height;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        // TODO: Explore sending as binary data
        this._getScaledPixelAt(x, y).map(c => this.frame.colours.push(c));
      }
    }
  }

  _setupFrameMeta() {
    this.frame = {
      meta: this.dimensions.getFrameMeta(),
      colours: []
    };
    this.frame.meta.id = parseInt(this.channel.name);
  }
}
