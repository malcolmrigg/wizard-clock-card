const CARDNAME = "wizard-clock-card";
const VERSION = "0.9.0";

const debugLogging = false;

class WizardClockCard extends HTMLElement {

  // Whenever the state changes, a new `hass` object is set: Update content.
  set hass(hass) {
    if (debugLogging) console.log(`${this.config.header ? "(" + this.config.header + ") " : ""}set hass start`);
    this._hass = hass;

    // Scale the canvas to fit the available space

    this.availableWidth = Math.min(this.card.offsetWidth, window.innerWidth, window.innerHeight).toFixed(0) - 16;
    if (debugLogging) console.log(`${this.config.header ? "(" + this.config.header + ") " : ""}availableWidth: ${this.availableWidth}px`);
    if (this.availableWidth <= 0) {
      if (debugLogging) console.log(`${this.config.header ? "(" + this.config.header + ") " : ""}skipping update`);
      return;
    }
    this.availableWidth = Math.round(Math.min(this.availableWidth, this.configuredWidth));

    this.canvas.width = this.configuredWidth;
    this.canvas.height = this.configuredWidth;
    this.canvas.style.width = `${this.availableWidth}px`;
    this.canvas.style.height = `${this.availableWidth}px`;
    this.scaleRatio = this.configuredWidth / this.availableWidth;

    this.radius = this.canvas.height / 2;
    this.ctx.translate(this.radius, this.radius);
    this.radius = this.radius * 0.90;

    // Cache theme colors once per hass update so drawing functions do not call
    // getComputedStyle on every animation frame.
    const cs = getComputedStyle(document.documentElement);
    this._colors = {
      primary:             cs.getPropertyValue('--primary-color'),
      primaryText:         cs.getPropertyValue('--primary-text-color'),
      secondaryBackground: cs.getPropertyValue('--secondary-background-color'),
      primaryBackground:   cs.getPropertyValue('--primary-background-color'),
    };

    // Get information about current locations and wizards

    this.zones = [];
    this.targetstate = [];

    if (this.lastframe && this.lastframe != 0){
      cancelAnimationFrame(this.lastframe);
      this.lastframe = 0;
    }

    var num;
    if (this.config.locations){
      for (num = 0; num < this.config.locations.length; num++){
        if (this.zones.indexOf(this.config.locations[num]) == -1){
          this.zones.push(this.config.locations[num]);
        }
      }
    }
    if (this.config.travelling){
      this.zones.push(this.config.travelling);
    }
    if (this.config.lost){
      this.zones.push(this.lostState);
    }

    for (num = 0; num < this.config.wizards.length; num++){
      var stateStr = this.getWizardState(this.config.wizards[num].entity);
      if (debugLogging) {
        console.log(`${this.config.header ? "(" + this.config.header + ") " : ""}(${this.config.wizards[num].name}) set hass stateStr: ${stateStr}`);
      }

      if (this.zones.indexOf(stateStr) == -1)  {
        if (typeof(stateStr)!=="string")
          throw new Error("Unable to add state for entity " + this.config.wizards[num].entity + " of type " + typeof(stateStr) + ".");
        this.zones.push(stateStr);
      }
    }

    if (this.zones.length < this.min_location_slots) {
      for (num = this.zones.length; num < this.min_location_slots; num++){
        this.zones.push(' ')
      }
    }

    this.lastframe = requestAnimationFrame(this._boundDrawClock);
    if (debugLogging) console.log(`${this.config.header ? "(" + this.config.header + ") " : ""}set hass end`);
  }

  // setConfig is called when the configuration changes.
  // Throw an exception and Home Assistant will render an error card.
  setConfig(config) {
    console.info("%c %s %c %s",
      "color: white; background: forestgreen; font-weight: 700;",
      CARDNAME.toUpperCase(),
      "color: forestgreen; background: white; font-weight: 700;",
      VERSION,
    );

    if (!config.wizards) {
      throw new Error('You need to define some wizards');
    }

    this.config = config;
    this.currentstate = [];
    this.lostState = config.lost ? config.lost : "Away";
    this.travellingState = config.travelling ? config.travelling : "Away";
    this.min_location_slots = this.config.min_location_slots ? this.config.min_location_slots : 0;

    if (this.config.shaft_colour){
      this.shaft_colour = this.config.shaft_colour;
    }
    else {
      this.shaft_colour = getComputedStyle(document.documentElement).getPropertyValue('--primary-color');
    }

    if (this.config.fontName) {
      this.selectedFont = this.config.fontName;
    } else {
      this.selectedFont = "itcblkad_font";
    }
    this.fontScale = 1.1;

    this.exclude = [];
    if (this.config.exclude){
      for (var num = 0; num < this.config.exclude.length; num++){
        if (this.exclude.indexOf(this.config.exclude[num]) == -1){
          this.exclude.push(this.config.exclude[num]);
        }
      }
    }

    // Set up document canvas.

    this.configuredWidth = this.config.width ? this.config.width : "500";

    // Bind the animation callback once so requestAnimationFrame reuses the same
    // function object instead of allocating a new closure on every call.
    this._boundDrawClock = () => this.drawClock();

    if (!this.canvas) {
      this.card = document.createElement('ha-card');
      if (this.config.header) {
        this.card.header = this.config.header;
      }
      var fontstyle = document.createElement('style');
      if (this.config.fontface){
        fontstyle.innerText = "@font-face { " + this.config.fontface + " }  ";
      } else {
        // my default
        fontstyle.innerText = "@font-face {    font-family: itcblkad_font;    src: local(itcblkad_font), url('/local/ITCBLKAD.TTF') format('opentype');}  ";
      }
      document.body.appendChild(fontstyle);

      this.div = document.createElement('div');
      this.div.style.textAlign = 'center';
      this.canvas = document.createElement('canvas');
      this.div.appendChild(this.canvas);
      this.card.appendChild(this.div);
      this.appendChild(this.card);
      if (!this.canvas.getContext)
        throw new Error("Browser does not support " + CARDNAME + " canvas.");
      this.ctx = this.canvas.getContext("2d");

      // Store the observer so disconnectedCallback can clean it up.
      this._resizeObserver = createResizeObserver(this);
      this._resizeObserver.observe(this.card);
    }
    if (debugLogging) console.log(`${this.config.header ? "(" + this.config.header + ") " : ""}getConfig end`);
  }

  // Clean up when the card is removed from the dashboard to prevent memory leaks.
  disconnectedCallback() {
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
    }
    if (this.lastframe) {
      cancelAnimationFrame(this.lastframe);
      this.lastframe = 0;
    }
    clearTimeout(this._resizeTimeout);
  }

  // getCardSize Indicates the height of the card in 50px units.
  // Home Assistant uses this to automatically distribute all cards over the available columns.
  getCardSize() {
    var cardSize = (this.configuredWidth / 50).toFixed(1);
    if (debugLogging) console.log(`${this.config.header ? "(" + this.config.header + ") " : ""}getCardSize = ${cardSize}`);
    return cardSize;
  }

  // get-WizardState makes all decisions about what stateStr should be. (What "number" to point to.)
  getWizardState(entity) {
    const state = this._hass.states[entity];
    if (!state) {
      console.log(`${this.config.header ? "(" + this.config.header + ") " : ""}Wizard ${entity} does not exist.`);
      return this.lostState;
    }
    const stateVelo = state && state.attributes ? (
      state.attributes.velocity ? state.attributes.velocity : (
        state.attributes.speed ? state.attributes.speed : (
          state.attributes.moving ? 16 : 0
    ))) : 0;

    /* Prioritize stateStr: 1. message attribute, 2. zone attribute, 3. state */
    var stateStr = "not_home";
    if (state && state.state && state.state !== "off" && state.state !== "unknown") {
        /* Keep the not-so-binary states from person_location integration */
        if (["home", "Home", "Just Arrived", "Just Left"].includes(state.state) && !this.exclude.includes(state.state)) {
          stateStr = state.state;
        } else if (state.attributes) {
            if (state.attributes.message) {
                stateStr = state.attributes.message;
            } else if (state.attributes.zone) {
                stateStr = state.attributes.zone;
            } else {
                stateStr = state.state;
            }
        } else {
            stateStr = state.state;
        }
    }
    /* Skip location if excluded in the config (could be reported below as locality, travelling, or lost */
    if (this.exclude.includes(stateStr)){
      stateStr = 'not_home';
    }
    /* Use friendly name for zones */
    if (this._hass.states["zone." + stateStr] && this._hass.states["zone." + stateStr].attributes && this._hass.states["zone." + stateStr].attributes.friendly_name)
    {
      stateStr = this._hass.states["zone." + stateStr].attributes.friendly_name;
    }
    /* If away and not in a zone, show locality (if locality is geocoded),
    /* otherwise show travelling (if configured and velocity > 15),
    /* otherwise show lost (if configured) or Away */
    if (stateStr.toLowerCase() === 'away' || stateStr === 'not_home') {
      if (stateVelo > 15 && this.config.travelling) {
        stateStr = this.travellingState;
      } else {
        stateStr = this.lostState;
      }
      if (state.attributes.locality && !this.exclude.includes(state.attributes.locality)) {
        stateStr = state.attributes.locality
      }
    } else if (stateStr === 'unavailable') {
      stateStr = this.lostState;
    }
    return stateStr;
  }

  drawClock() {
    this.lastframe = 0;

    // Clear the full canvas. The origin is translated to centre so we offset by
    // half each dimension to reach the top-left corner.
    this.ctx.clearRect(-this.canvas.width/2, -this.canvas.height/2, this.canvas.width, this.canvas.height);
    this.drawFace(this.ctx, this.radius);
    this.drawNumbers(this.ctx, this.radius, this.zones);
    this.drawTime(this.ctx, this.radius, this.zones, this.config.wizards);
    this.drawHinge(this.ctx, this.radius, this.shaft_colour);
    // request next frame if required
    var redraw = false;
    var num;
    for (num = 0; num < this.currentstate.length; num++){
      if (Math.round(this.currentstate[num].pos*100) != Math.round(this.targetstate[num].pos*100))
      {
        redraw = true;
      }
    }

    if (redraw){
      this.lastframe = requestAnimationFrame(this._boundDrawClock);
    }
  }

  drawFace(ctx, radius) {
    ctx.save();
    ctx.shadowColor = null;
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, 2*Math.PI);
    ctx.fillStyle = this._colors.secondaryBackground;
    ctx.fill();

    ctx.strokeStyle = this._colors.primaryBackground;
    ctx.lineWidth = radius*0.02;
    ctx.stroke();
    ctx.restore();
  }

  drawHinge(ctx, radius, colour) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, radius*0.05, 0, 2*Math.PI);
    ctx.fillStyle = colour;
    ctx.shadowColor = "#0008";
    ctx.shadowBlur = 10;
    ctx.shadowOffsetX = 5;
    ctx.shadowOffsetY = 5;
    ctx.fill();
    ctx.restore();
  }

  drawNumbers(ctx, radius, locations) {
      /*
        Text on a curve code modified from function written by James Alford here: http://blog.graphicsgen.com/2015/03/html5-canvas-rounded-text.html
      */
      var num;
      ctx.font = radius*0.15*this.fontScale + "px " + this.selectedFont;
      ctx.textBaseline="middle";
      ctx.textAlign="center";
      ctx.fillStyle = this._colors.primaryText;

      // Measure font height via canvas metrics rather than forcing a DOM reflow
      // on every frame (the previous approach appended/removed a div each call).
      const heightMetrics = ctx.measureText("Mg");
      const textHeight = heightMetrics.actualBoundingBoxAscent + heightMetrics.actualBoundingBoxDescent;

      for(num= 0; num < locations.length; num++){
          // ctx.save/restore handles all accumulated per-character rotations,
          // replacing the manual undo rotations at the end of each iteration.
          ctx.save();

          var ang = num * Math.PI / locations.length * 2;
          ctx.rotate(ang);

          var startAngle = 0;
          var inwardFacing = true;
          var kerning = 0;
          var text = locations[num].split("").reverse().join("");
          // if we're in the bottom half of the clock then reverse the facing of the text so that it's not upside down
          if (ang > Math.PI / 2 && ang < ((Math.PI * 2) - (Math.PI / 2)))
          {
            startAngle = Math.PI;
            inwardFacing = false;
            text = locations[num];
          }

          text = this.isRtlLanguage(text) ? text.split("").reverse().join("") : text;

          // rotate 50% of total angle for center alignment
          for (var j = 0; j < text.length; j++) {
              var charWid = ctx.measureText(text[j]).width;
              startAngle += ((charWid + (j == text.length-1 ? 0 : kerning)) / (radius - textHeight)) / 2 ;
          }

          // Phew... now rotate into final start position
          ctx.rotate(startAngle);

          // Now for the fun bit: draw, rotate, and repeat
          for (var j = 0; j < text.length; j++) {
              var charWid = ctx.measureText(text[j]).width; // half letter
              // rotate half letter
              ctx.rotate((charWid/2) / (radius - textHeight) * -1);
              // draw the character at "top" or "bottom"
              // depending on inward or outward facing
              ctx.fillText(text[j], 0, (inwardFacing ? 1 : -1) * (0 - radius + textHeight ));

              ctx.rotate((charWid/2 + kerning) / (radius - textHeight) * -1); // rotate half letter
          }

          ctx.restore();
      }
  }

  isRtlLanguage(text) {
    const rtlChar = /[֐-׿؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
    return rtlChar.test(text);
  }

  drawTime(ctx, radius, locations, wizards){
      this.targetstate = [];
      var num;
      for (num = 0; num < wizards.length; num++){
        const state = this._hass.states[wizards[num].entity];
        var stateStr = state && state.state != "off" && state.state != "unknown" ?
          (state.attributes ?
            (state.attributes.message ? state.attributes.message : state.state)
            : state.state
          )
          :  this.lostState;
        /* Point to locality if not in a zone (if locality is geocoded) */
        if (stateStr === 'Away') {
          if (state.attributes.locality) {
            stateStr = state.attributes.locality
          }
        }

        if (this.exclude.includes(stateStr) ||
	  (this._hass.states["zone." + stateStr] && this._hass.states["zone." + stateStr].attributes && this._hass.states["zone." + stateStr].attributes.friendly_name &&
          this.exclude.includes(this._hass.states["zone." + stateStr].attributes.friendly_name))) {

          stateStr = this.lostState;
	}
        // Check both velocity and proximity for movement
        const stateVelo = state && state.attributes ? (
          state.attributes.velocity ? state.attributes.velocity : (
            state.attributes.moving ? 16 : 0
          )) : 0;

        // New: Check proximity direction sensor if configured
        const isMovingByProximity = wizards[num].proximity_sensor &&
          this._hass.states[wizards[num].proximity_sensor] &&
          ['towards', 'away_from'].includes(this._hass.states[wizards[num].proximity_sensor].state);

        var locnum;
        var wizardOffset = ((num-((wizards.length-1)/2)) / wizards.length * 0.6);
        var location = wizardOffset; // default
        for (locnum = 0; locnum < locations.length; locnum++){
          if ((locations[locnum].toLowerCase() == stateStr.toLowerCase())
            || (locations[locnum] == this.travellingState && (stateVelo > 15 || isMovingByProximity))
            || (locations[locnum] == this.lostState && stateStr == "not_home" && stateVelo <= 15 && !isMovingByProximity))
          {
            location = locnum + wizardOffset;
            break;
          }
        }
        location = location * Math.PI / locations.length * 2;
        // set targetstate
        this.targetstate.push({pos: location, length: radius*0.7, width: radius*0.1, wizard: wizards[num].name, colour: wizards[num].colour, textcolour: wizards[num].textcolour});
      }
      // update currentstate from targetstate
      if (!this.currentstate)
      {
        this.currentstate = [];
      }
      for (num = 0; num < wizards.length; num++){
        if (this.currentstate[num]){
          this.currentstate[num].pos = this.currentstate[num].pos + ((this.targetstate[num].pos - this.currentstate[num].pos) / 60);
        } else {
          // default to 12 o'clock to start
          this.currentstate.push({pos: 0, length: this.targetstate[num].length, width: this.targetstate[num].width, wizard: this.targetstate[num].wizard, colour: this.targetstate[num].colour, textcolour: this.targetstate[num].textcolour});
        }
      }
      // draw currentstate
      for (num = 0; num < wizards.length; num++){
        this.drawHand(ctx, this.currentstate[num].pos, this.currentstate[num].length, this.currentstate[num].width, this.currentstate[num].wizard, this.currentstate[num].colour, this.currentstate[num].textcolour);
      }
  }

  drawHand(ctx, pos, length, width, wizard, colour, textcolour) {
    // ctx.save/restore replaces the manual rotate(-pos) / translate(0, length/2)
    // undo operations, which could accumulate floating-point error over time.
    ctx.save();
    ctx.beginPath();
    ctx.lineWidth = width;
    ctx.fillStyle = colour || this._colors.primary;
    ctx.shadowColor = "#0008";
    ctx.shadowBlur = 10;
    ctx.shadowOffsetX = 5;
    ctx.shadowOffsetY = 5;
    ctx.moveTo(0,0);
    ctx.rotate(pos);
    ctx.quadraticCurveTo(width, -length*0.5, width, -length*0.75);
    ctx.quadraticCurveTo(width*0.2, -length*0.8, 0, -length);
    ctx.quadraticCurveTo(-width*0.2, -length*0.8, -width, -length*0.75);
    ctx.quadraticCurveTo(-width, -length*0.5, 0, 0);
    ctx.fill();

    ctx.font = width*this.fontScale + "px " + this.selectedFont;
    ctx.fillStyle = textcolour || this._colors.primaryText;
    ctx.translate(0, -length/2);
    ctx.rotate(Math.PI/2);
    if (pos < Math.PI && pos >= 0)
        ctx.rotate(Math.PI);
    ctx.fillText(wizard, 0, 0);
    ctx.restore();
  }

}

// Resize debounce timeout is stored per-instance so multiple clock cards on
// the same dashboard do not interfere with each other.
function createResizeObserver(thisObject) {
  return new ResizeObserver((entries) => {
    clearTimeout(thisObject._resizeTimeout);
    thisObject._resizeTimeout = setTimeout(() => {
      if (debugLogging) console.log(`${thisObject.config && thisObject.config.header ? "(" + thisObject.config.header + ") " : ""}debouncedOnResize triggering set hass`);
      thisObject.hass = thisObject._hass;
    }, 500);
  });
}

customElements.define(CARDNAME, WizardClockCard);
