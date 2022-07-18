if (window.CanvasRenderingContext2D) {
  CanvasRenderingContext2D.prototype.diamond = function(x, y, width, height) {
    // if values are not set just exit
    if(!x || !y || !width || !height) { return true; }

    this.beginPath();
    this.moveTo(x + width*0.5, y);
    this.lineTo(x, y + height*0.5);
    this.lineTo(x + width*0.5, y + height);
    this.lineTo(x + width, y +height*0.5);
    this.lineTo(x + width*0.5, y);
    this.closePath();  
  };
}if (window.CanvasRenderingContext2D) {
  CanvasRenderingContext2D.prototype.ellipse = function(x, y, width, height) {
    // if values are not set just exit
    if(!x || !y || !width || !height) { return true; }

    var kappa = .5522848,
        ox = (width / 2) * kappa,  // control point offset horizontal
        oy = (height / 2) * kappa, // control point offset vertical
        xe = x + width,            // x-end
        ye = y + height,           // y-end
        xm = x + width/2,          // x-middle
        ym = y + height/2;         // y-middle

    this.beginPath();
    this.moveTo(x, ym);
    this.bezierCurveTo(x, ym - oy, xm - ox, y, xm, y);
    this.bezierCurveTo(xm + ox, y, xe, ym - oy, xe, ym);
    this.bezierCurveTo(xe, ym + oy, xm + ox, ye, xm, ye);
    this.bezierCurveTo(xm - ox, ye, x, ym + oy, x, ym);
    this.closePath();
  };
}if (window.CanvasRenderingContext2D) {
  CanvasRenderingContext2D.prototype.fillArea = function(x, y, color) {
    
    // if values are not set just exit
    if(!x || !y || !color) { return true; }

    var width = this.canvas.width,
        height = this.canvas.height,
        image = this.getImageData(0, 0, width, height),
        imageData = image.data,
        pixelStack = [[x, y]],
        px1, newPos, pixelPos, reachLeft, reachRight, colorTemp;

    function _getPixel(pixelPos) {
      return {r:imageData[pixelPos], g:imageData[pixelPos+1], b:imageData[pixelPos+2], a:imageData[pixelPos+3]};
    }

    function _setPixel(pixelPos) {
      imageData[pixelPos] = color.r;
      imageData[pixelPos+1] = color.g;
      imageData[pixelPos+2] = color.b;
      imageData[pixelPos+3] = color.a;
    }

    function _comparePixel(px2) {
      return (px1.r === px2.r && px1.g === px2.g && px1.b === px2.b && px1.a === px2.a);
    }

    // get pixel at x/y position
    px1 = _getPixel(((y * width) + x) * 4);

    // quick way to get formatted rgba color
    colorTemp =this.canvas.style.color;
    this.canvas.style.color = color;
    color = this.canvas.style.color.match(/^rgba?\((.*)\);?$/)[1].split(',');
    this.canvas.style.color = colorTemp;

    color = {
      r: parseInt(color[0], 10),
      g: parseInt(color[1], 10),
      b: parseInt(color[2], 10),
      a: parseInt(color[3] || 255, 10)
    };

    // if pixel and color the same do nothing
    if (_comparePixel(color)) { return true; }

    while (pixelStack.length) {
      newPos = pixelStack.pop();

      pixelPos = (newPos[1]*width + newPos[0]) * 4;
      while(newPos[1]-- >= 0 && _comparePixel(_getPixel(pixelPos))) {
        pixelPos -= width * 4;
      }
      
      pixelPos += width * 4;
      ++newPos[1];
      reachLeft = false;
      reachRight = false;
      
      while (newPos[1]++ < height-1 && _comparePixel(_getPixel(pixelPos))) {
        _setPixel(pixelPos);

        if (newPos[0] > 0) {
          if (_comparePixel(_getPixel(pixelPos - 4))) {
            if (!reachLeft) {
              pixelStack.push([newPos[0] - 1, newPos[1]]);
              reachLeft = true;
            }
          }
          else if(reachLeft) {
            reachLeft = false;
          }
        }
      
        if (newPos[0] < width-1) {
          if (_comparePixel(_getPixel(pixelPos + 4))) {
            if (!reachRight) {
              pixelStack.push([newPos[0] + 1, newPos[1]]);
              reachRight = true;
            }
          }
          else if(reachRight) {
            reachRight = false;
          }
        }
          
        pixelPos += width * 4;
      }
    }

    this.putImageData(image, 0, 0);
  };
}if (window.CanvasRenderingContext2D) {
  CanvasRenderingContext2D.prototype.hexagon = function(x, y, width, height) {
    // if values are not set just exit
    if(!x || !y || !width || !height) { return true; }

  	var facShort = 0.225,
    	  facLong = 1 - facShort;

    this.beginPath();
    this.moveTo(x + width*0.5, y);
    this.lineTo(x, y + height*facShort);
    this.lineTo(x, y + height*facLong);
    this.lineTo(x + width*0.5, y + height);
    this.lineTo(x + width, y + height*facLong);
    this.lineTo(x + width, y + height*facShort);
    this.lineTo(x + width*0.5, y);
    this.closePath();  
  };
}if (window.CanvasRenderingContext2D) {
  CanvasRenderingContext2D.prototype.ninjaStar = function(x, y, width, height) {
    // if values are not set just exit
    if(!x || !y || !width || !height) { return true; }

    this.beginPath();
    this.moveTo(x + width*0.5, y);
    this.lineTo(x + width*0.35, y + height*0.35);
    this.lineTo(x, y + height*0.5);
    this.lineTo(x + width*0.35, y + height*0.65);
    this.lineTo(x + width*0.5, y + height);
    this.lineTo(x + width*0.65, y + height*0.65);
    this.lineTo(x + width, y +height*0.5);
    this.lineTo(x + width*0.65, y + height*0.35);
    this.lineTo(x + width*0.5, y);
    this.closePath();  
  };
}if (window.CanvasRenderingContext2D) {
  CanvasRenderingContext2D.prototype.octagon = function(x, y, width, height) {
    // if values are not set just exit
    if(!x || !y || !width || !height) { return true; }

    var facShort = 0.275,
    	  facLong = 1 - facShort;

    this.beginPath();
    this.moveTo(x + width*facShort, y);
    this.lineTo(x, y + height*facShort);
    this.lineTo(x, y + height*facLong);
    this.lineTo(x + width*facShort, y + height);
    this.lineTo(x + width*facLong, y + height);
  	this.lineTo(x + width, y + height*facLong);
    this.lineTo(x + width, y + height*facShort);
    this.lineTo(x + width*facLong, y);
    this.lineTo(x + width*facShort, y);
    this.closePath();  
  };
}if (window.CanvasRenderingContext2D) {
  CanvasRenderingContext2D.prototype.parallelogram = function(x, y, width, height) {
    // if values are not set just exit
    if(!x || !y || !width || !height) { return true; }

    this.beginPath();
    this.moveTo(x + width*0.3, y);
    this.lineTo(x, y + height);
    this.lineTo(x + width*0.7, y + height);
    this.lineTo(x + width, y);
    this.lineTo(x + width*0.3, y);
    this.closePath();  
  };
}if (window.CanvasRenderingContext2D) {
  CanvasRenderingContext2D.prototype.pentagon = function(x, y, width, height) {
    // if values are not set just exit
    if(!x || !y || !width || !height) { return true; }

    this.beginPath();
    this.moveTo(x + width/2, y);
    this.lineTo(x, y + height*0.4);
    this.lineTo(x + width*0.2, y + height);
    this.lineTo(x + width*0.8, y + height);
    this.lineTo(x + width, y + height*0.4);
    this.lineTo(x + width/2, y);
    this.closePath();  
  };
}if (window.CanvasRenderingContext2D) {
  CanvasRenderingContext2D.prototype.roundedRect = function(x, y, width, height, radius) {
    // if values are not set just exit
    if(!x || !y || !width || !height) { return true; }

    if (!radius) { radius = 5; }

    this.beginPath();
    this.moveTo(x + radius, y);
    this.lineTo(x + width - radius, y);
    this.quadraticCurveTo(x + width, y, x + width, y + radius);
    this.lineTo(x + width, y + height - radius);
    this.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    this.lineTo(x + radius, y + height);
    this.quadraticCurveTo(x, y + height, x, y + height - radius);
    this.lineTo(x, y + radius);
    this.quadraticCurveTo(x, y, x + radius, y);
    this.closePath();
  };
}if (window.CanvasRenderingContext2D) {
  CanvasRenderingContext2D.prototype.star = function(x, y, width, height) {
    // if values are not set just exit
    if(!x || !y || !width || !height) { return true; }

    this.beginPath();
    this.moveTo(x + width*0.5, y);
    this.lineTo(x + width*0.375, y + height*0.4);
    this.lineTo(x, y + height*0.4);
    this.lineTo(x + width*0.3, y + height*0.625);
    this.lineTo(x + width*0.2, y + height);
    this.lineTo(x + width*0.5, y + height*0.725);
    this.lineTo(x + width*0.8, y + height);
    this.lineTo(x + width*0.7, y + height*0.625);
    this.lineTo(x + width, y + height*0.4);
    this.lineTo(x + width*0.625, y + height*0.4);
    this.lineTo(x + width*0.5, y);
    this.closePath(); 
  };
}if (window.CanvasRenderingContext2D) {
  CanvasRenderingContext2D.prototype.trapezoid = function(x, y, width, height) {
    // if values are not set just exit
    if(!x || !y || !width || !height) { return true; }

    this.beginPath();
    this.moveTo(x + width*0.2, y);
    this.lineTo(x, y + height);
    this.lineTo(x + width, y + height);
    this.lineTo(x + width*0.8, y);
    this.lineTo(x + width*0.3, y);
    this.closePath();  
  };
}if (window.CanvasRenderingContext2D) {
  CanvasRenderingContext2D.prototype.triangle = function(x, y, width, height) {
    // if values are not set just exit
    if(!x || !y || !width || !height) { return true; }

    this.beginPath();
    this.moveTo(x + width/2, y);
    this.lineTo(x, y + height);
    this.lineTo(x + width, y + height);
    this.lineTo(x + width/2, y);
    this.closePath();  
  };
}