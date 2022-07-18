/**
 * @author Albert J. Kooistra <info@klifs.net>
 */

var drawn = [];
var index = 0;
var proteome = [];
var previousClick = null;
var previousFound = null;
var releaseDate = "";
var first = true;

function gpcr(x, y, radius, name, full) {
   this.x = x;
   this.y = y;
   this.radius = radius;
   this.name = name;
   this.full = full;
   this.isPointInside = function (x, y) {
      return (x >= this.x - this.radius &&
         x <= this.x + this.radius &&
         y >= this.y - this.radius &&
         y <= this.y + this.radius);
   }
}

function getColorFromGradient(gradient, dotvalue) {
   var dotcolor;
   var colorvalue = dotvalue;
   if (gradient == "red-yellow-green-blue" || gradient == "green-yellow-red" || gradient == "green-red" || gradient == "red-blue" || gradient == "green-yellow")
      colorvalue = 1 - dotvalue;
   switch (gradient) {
      case "blue-green-yellow-red":
      case "red-yellow-green-blue":
         if (colorvalue < 0.33) {
            // blue-green
            var gradient = new warna.Gradient('#0000ff', '#00ff00')
            dotcolor = gradient.getPosition(colorvalue / 0.33).hex;
         } else if (colorvalue < 0.66) {
            // green-yellow
            var gradient = new warna.Gradient('#00ff00', '#ffff00')
            dotcolor = gradient.getPosition((colorvalue - 0.33) / 0.33).hex;
         } else {
            // yellow-red
            var gradient = new warna.Gradient('#ffff00', '#ff0000')
            dotcolor = gradient.getPosition((colorvalue - 0.66) / 0.34).hex;
         }
         break;
      case "red-yellow-green":
      case "green-yellow-red":
         if (colorvalue < 1 / 2) {
            // red-yellow
            var gradient = new warna.Gradient('#ff0000', '#ffff00')
            dotcolor = gradient.getPosition(colorvalue / (1 / 2)).hex;
         } else {
            // yellow-green
            var gradient = new warna.Gradient('#ffff00', '#00ff00')
            dotcolor = gradient.getPosition((colorvalue - (1 / 2)) / (1 / 2)).hex;
         }
         break;
      case "red-green":
      case "green-red":
         var gradient = new warna.Gradient('#ff0000', '#00ff00')
         dotcolor = gradient.getPosition(colorvalue).hex;
         break;
      case "blue-red":
      case "red-blue":
         var gradient = new warna.Gradient('#ff0000', '#0000ff')
         dotcolor = gradient.getPosition(colorvalue).hex;
         break;
      case "yellow-green":
      case "green-yellow":
         var gradient = new warna.Gradient('#ffff00', '#00ff00')
         dotcolor = gradient.getPosition(colorvalue).hex;
         break;
      default:
         var gradient = new warna.Gradient('#ffff00', '#00ffff')
         dotcolor = gradient.getPosition(colorvalue).hex;
         break;
   }
   return dotcolor;
}

function drawLegend(min, max) {
   var startPositionX = context.canvas.clientWidth - 30;
   var startPositionY = 100;
   var legendWidth = 15;
   var blockHeight = 5;
   context = $('#proteome')[0].getContext("2d");
   var gradient = $("#gradient option:selected").text();
   for (var i = 0; i <= 100; i++) {
      context.beginPath();
      context.rect(startPositionX, startPositionY + i * blockHeight, legendWidth, 5);
      context.fillStyle = getColorFromGradient(gradient, i / 100);
      context.globalAlpha = $("#dottransparency option:selected").val();
      context.fill();
      context.lineWidth = 0;
      context.strokeStyle = 'rgba(0,0,0,0)';
      context.stroke();
   }

   // border around legend
   context.beginPath();
   context.rect(startPositionX, startPositionY, legendWidth, 101 * blockHeight);
   context.lineWidth = 2;
   context.strokeStyle = 'rgba(0,0,0,1)';
   context.stroke();

   // new settings
   context.font = "20px Arial";
   context.globalAlpha = 0.7;
   context.fillStyle = 'black';

   // add minimum label
   var w_min = context.measureText(min).width;
   context.beginPath();
   context.fillText(min, startPositionX + legendWidth / 2 - w_min / 2, startPositionY - 5);
   context.stroke();

   // add maximum label
   var w_max = context.measureText(max).width;
   context.beginPath();
   context.fillText(max, startPositionX + legendWidth / 2 - w_max / 2, startPositionY + 101 * blockHeight + 20);
   context.stroke();
}

function drawGPCR(name, x, y, full, dotvalue) {
   context = $('#proteome')[0].getContext("2d");
   context.beginPath();

   var dotsize = $("#dotsize option:selected").text();
   var dotcolor = $("#dotcolor option:selected").text();

   if (!isNaN(dotvalue) && dotvalue != Number.MIN_SAFE_INTEGER) {

      var option = $("#valuemodifier option:selected").text();
      if (option == "dot size" || option == "both") {
         dotsize = 6 + (dotvalue * 9);
      }
      if (option == "dot color" || option == "both") {
         var gradient = $("#gradient option:selected").text();
         var dotcolor = getColorFromGradient(gradient, dotvalue)
      }
   }

   var shape = $("#dotshape option:selected").text();
   var refX = (context.canvas.clientWidth - 100) * x + 50;
   var refY = (context.canvas.clientHeight - 100) * y + 50;
   switch (shape) {
      case "triangle":
         context.triangle(refX - dotsize, refY - dotsize, dotsize * 2, dotsize * 2);
         break;
      case "rectangle":
         context.rect(refX - dotsize, refY - dotsize, dotsize * 2, dotsize * 2);
         break;
      case "rounded rectangle":
         context.roundedRect(refX - dotsize, refY - dotsize, dotsize * 2, dotsize * 2);
         break;
      case "diamond":
         context.diamond(refX - dotsize, refY - dotsize, dotsize * 2, dotsize * 2);
         break;
      case "pentagon":
         context.pentagon(refX - dotsize, refY - dotsize, dotsize * 2, dotsize * 2);
         break;
      case "hexagon":
         context.hexagon(refX - dotsize, refY - dotsize, dotsize * 2, dotsize * 2);
         break;
      case "octagon":
         context.octagon(refX - dotsize, refY - dotsize, dotsize * 2, dotsize * 2);
         break;
      case "star":
         context.star(refX - dotsize, refY - dotsize, dotsize * 2, dotsize * 2);
         break;
      case "circle":
      default:
         context.arc(refX, refY, dotsize, 0, 2 * Math.PI);
         break;
   }
   context.fillStyle = dotcolor;
   context.globalAlpha = $("#dottransparency option:selected").val();

   //context.fillStyle = 'rgba(255,0,0,0.5)';
   context.fill();
   context.lineWidth = 1;
   context.strokeStyle = 'rgba(0,0,0,0.5)';
   context.stroke();
   var entry = new gpcr((context.canvas.clientWidth - 100) * x + 50, (context.canvas.clientHeight - 100) * y + 50, 6 + 1, name, full);
   drawn.push(entry);

}


function drawText(x, y, name, full) {
   ctx = $('#proteomeoverlay')[0].getContext("2d");

   // transparent white backdrop
   ctx.font = "20px Arial";
   var w_name = ctx.measureText(name).width;
   ctx.font = "12px Arial";
   var w_full = ctx.measureText(full).width;

   var w = Math.max(w_name, w_full);

   changeDirection = ((x + w + 15) > ctx.canvas.width);

   ctx.beginPath();
   ctx.lineWidth = 0;
   ctx.fillStyle = 'rgba(255,255,255,1)';
   ctx.strokeStyle = 'white';
   ctx.font = "20px Arial";
   if (changeDirection) {
      ctx.rect(x - w - 25, y + 10 - 30, w + 15, 45);
      ctx.fill();

      // draw text
      ctx.fillStyle = 'black';
      ctx.fillText(name, x - w - 15, y + 5);
      ctx.font = "12px Arial";
      ctx.fillText(full, x - w - 15, y + 17);
   } else {
      ctx.rect(x + 10, y + 10 - 30, w + 15, 45);
      ctx.fill();

      // draw text
      ctx.fillStyle = 'black';
      ctx.fillText(name, x + 15, y + 5);
      ctx.font = "12px Arial";
      ctx.fillText(full, x + 15, y + 17);
   }
}

function clearOverlay() {
   ctx = $('#proteomeoverlay')[0].getContext("2d");
   ctx.clearRect(0, 0, $('#proteomeoverlay')[0].width, $('#proteomeoverlay')[0].height);
}

function initGPCRome(mapAllPoints) {
   var drawctx = $('#proteome')[0].getContext("2d");
   var ratio = 1;
   drawctx.canvas.width = ratio * 1185 + 100;
   drawctx.canvas.height = ratio * 1125 + 100;

   // adjust overlay
   var overlayctx = $('#proteomeoverlay')[0].getContext("2d");
   overlayctx.canvas.width = 1185 * ratio + 100;
   overlayctx.canvas.height = 1125 * ratio + 100;

   var img = new Image();
   img.onload = function () {
      drawctx.drawImage(img, 50, 50, ratio * 1125, ratio * 1125);
      if (mapAllPoints)
         setTimeout(function () {
            showFullGPCRome()
         }, 10);

      $('#proteomeoverlay').mousemove(function (evt) {
         var x = evt.pageX - $('#proteomeoverlay').offset().left;
         var y = evt.pageY - $('#proteomeoverlay').offset().top;

         var found = false;
         for (var i = 0; i < drawn.length; i++) {
            if (drawn[i].isPointInside(x, y)) {
               if (previousFound == null || previousFound != i) {
                  clearOverlay();
                  drawText(drawn[i].x, drawn[i].y, drawn[i].name, drawn[i].full);
                  previousFound = i;
               }
               found = true;
               break;
            }
         }
         if (!found) {
            clearOverlay();
            previousFound = null;
         }
      });
   }
   img.crossOrigin = "Anonymous";
   img.src = "images/GPCR_from_scratch_v8.png";
}

function showFullGPCRome() {
   for (var i = 0; i < gpcrEntries.length; i++) {
      drawGPCR(gpcrEntries[i][0], gpcrEntries[i][2], gpcrEntries[i][3], gpcrEntries[i][1]);
   }
}

function mapCustomIDs(input) {
   if (first) {
      first = false;
      cleanGPCRome();
      setTimeout(function () {
         mapCustomIDs(input)
      }, 150);
   } else {
      /* Process the GPCR IDs provided by the user */
      var userIDs = input.split('\n');
      var noMap = "Could not map:\n\n";
      var noMapCount = 0;
      var dictionaryKeys = Object.keys(gpcrDictionary);

      // Test if customIDs contain values: comma separated - with number as second part
      var numerical = false;
      var max = Number.MIN_SAFE_INTEGER;
      var min = Number.MAX_SAFE_INTEGER;
      for (var i = 0; i < userIDs.length; i++) {
         var split = userIDs[i].split(',');
         if (split.length == 2) {
            if (!isNaN(split[1])) {
               var test = parseFloat(split[1]);
               numerical = true;
               if (test < min) {
                  min = test;
               }
               if (test > max) {
                  max = test;
               }
            }
         }
      }
      console.log("Logging the minimum and maximum (" + max + " to " + min + ") and information is a number: " + numerical);

      for (var i = 0; i < userIDs.length; i++) {
         if (userIDs[i] != "") {
            var userID = userIDs[i].toUpperCase();
            var dotvalue = Number.MIN_SAFE_INTEGER;
            if (numerical) {
               var split = userID.split(',');
               userID = split[0];
               if (!isNaN(split[1])) {
                  dotvalue = (split[1] - min) / (max - min);
                  console.log("Setting " + dotvalue + " for " + userID);
               }
            }
            if (gpcrDictionary[userID] != undefined) {
               var match = gpcrDictionary[userID];
               drawGPCR(gpcrEntries[match][0], gpcrEntries[match][2], gpcrEntries[match][3], gpcrEntries[match][1], dotvalue);
            } else if (userID.indexOf(".") >= 0 || userID.indexOf("*") >= 0 || userID.indexOf("?") >= 0) { // wildcards match look-up
               // Wildcards search based on regex search
               var result = dictionaryKeys.filter(function (item) {
                  return typeof item == 'string' && item.match(globStringToRegex(userID)) != null;
               });

               // Get all unique IDs
               var matches = {};
               for (var j = 0; j < result.length; j++) {
                  matches[gpcrDictionary[result[j]]] = gpcrDictionary[result[j]];
               }

               // Draw on GPCRome
               var matches_unique = Object.keys(matches);
               for (var j = 0; j < matches_unique.length; j++) {
                  var match = matches_unique[j];
                  drawGPCR(gpcrEntries[match][0], gpcrEntries[match][2], gpcrEntries[match][3], gpcrEntries[match][1], dotvalue);
               }
            } else {
               noMap += userIDs[i] + "\n";
               noMapCount++;
            }
         }
      }
      // Check if dot color is modified by values
      if (numerical && noMapCount < userIDs.length) {
         var option = $("#valuemodifier option:selected").text();
         if (option == "dot color" || option == "both") {
            drawLegend(min, max);
         }
      }
      if (noMapCount > 0) {
         window.alert(noMap);
      }
   }
}

function mapMissingCustomIDs(input) {
   if (first) {
      first = false;
      cleanGPCRome();
      setTimeout(function () {
         mapMissingCustomIDs(input)
      }, 150);
   } else {
      var userIDs = input.split('\n');

      var mapped = {};
      for (var i = 0; i < userIDs.length; i++) {
         if (userIDs[i] != "") {
            var userID = userIDs[i].toUpperCase();
            if (gpcrDictionary[userID] != undefined) {
               var match = gpcrDictionary[userID];
               mapped[match] = match;
            }
         }
      }

      for (var i = 0; i < gpcrEntries.length; i++) {
         if (mapped[i] == undefined) {
            drawGPCR(gpcrEntries[i][0], gpcrEntries[i][2], gpcrEntries[i][3], gpcrEntries[i][1]);
         }
      }
   }
}

function globStringToRegex(str) {
   return new RegExp(preg_quote(str).replace(/\\\*/g, '.*').replace(/\\\?/g, '.'), 'g');
}

// http://kevin.vanzonneveld.net | http://phpjs.org/functions/preg_quote/
function preg_quote(str, delimiter) {
   // +   original by: booeyOH
   // +   improved by: Ates Goral (http://magnetiq.com)
   // +   improved by: Kevin van Zonneveld (http://kevin.vanzonneveld.net)
   // +   bugfixed by: Onno Marsman
   // +   improved by: Brett Zamir (http://brett-zamir.me)
   // +   improved by: Albert J. Kooistra
   return '^' + (str + '').replace(new RegExp('[.\\\\+*?\\[\\^\\]$(){}=!<>|:\\' + (delimiter || '') + '-]', 'g'), '\\$&') + '$';
}

function cleanGPCRome() {
   first = false;
   drawn = [];
   initGPCRome(false);
}

function fullMap() {
   first = false;
   cleanGPCRome();
   setTimeout(function () {
      showFullGPCRome()
   }, 150);
}

function showCrystallized() {
   first = false;
   cleanGPCRome();
   setTimeout(function () {
      mapCrystallized()
   }, 150);
}

function mapCrystallized() {
   first = false;
   mapCustomIDs(structs.join("\n"));
}

function dumpGPCRome() {
   $('#log').append("<br/><br/><br/>----- DUMP ------<br/><br/><br/>");
   var log = "";
   for (var i = 0; i < gpcrEntries.length; i++)
      log = log + "[\"" + gpcrEntries[i][0] + "\", \"" + gpcrEntries[i][1] + "\", " + gpcrEntries[i][2] + ", " + gpcrEntries[i][3] + ", " + gpcrEntries[i][4] + "],\n";
   copyGPCRome(log);
}

function copyGPCRome(text) {
   var textArea = document.createElement("textarea");

   textArea.style.position = 'fixed';
   textArea.style.top = 0;
   textArea.style.left = 0;
   textArea.style.width = '2em';
   textArea.style.height = '2em';
   textArea.style.padding = 0;
   textArea.style.border = 'none';
   textArea.style.outline = 'none';
   textArea.style.boxShadow = 'none';
   textArea.style.background = 'transparent';
   textArea.value = text;
   document.body.appendChild(textArea);
   textArea.select();
   try {
      var successful = document.execCommand('copy');
      var msg = successful ? 'successful' : 'unsuccessful';
      console.log('Copying text command was ' + msg);
   } catch (err) {
      console.log('Oops, unable to copy');
   }
   document.body.removeChild(textArea);
}
