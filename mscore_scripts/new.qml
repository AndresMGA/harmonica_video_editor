import FileIO 3.0
import MuseScore 3.0

MuseScore {

    version: "1.0"
    description: "new"
    menuPath: "Plugins.new"
    requiresScore: true
    property string tmpDir: "/home/andres/harmonica_video_editor/tmp"
    property real svgDpi: 12.0

    property int defaultTabHoles: 12
    property var tabsChromatic: [
        "1", "1*", "-1", "-1*", "2", "-2", "-2*", "3", "3*", "-3", "-3*", "-4",
        "5", "5*", "-5", "-5*", "6", "-6", "-6*", "7", "7*", "-7", "-7*", "-8",
        "9", "9*", "-9", "-9*", "10", "-10", "-10*", "11", "11*", "-11", "-11*", "-12",
        "12", "12*", "-12*"
    ]
    property var tabsDiatonic: [
        "1", "-1'", "-1", "na", "2", "-2''", "-2'", "3", "-3'''", "-3''", "-3'", "-3",
        "4", "-4'", "-4", "na", "5", "-5", "na", "6", "-6'", "-6", "na", "-7",
        "7", "na", "-8", "8'", "8", "-9", "9'", "9", "na", "-10", "10''", "10'", "10"
    ]
    FileIO {
        id: jsonFile
        onError: console.log(msg)
        }

    FileIO {
        id: statusFile
        onError: console.log(msg)
        }

    FileIO {
        id: positionsFile
        onError: console.log(msg)
        }

function getChordsAndRests(){
   var cursor = curScore.newCursor();
   cursor.staffIdx = 0;
   var chordsAndRests=[];
   cursor.voice = 0;
   cursor.rewind(Cursor.SCORE_START);
 
      
      while (cursor.segment) {
            var e = cursor.element;
        
            if (e) {
                 
                  if (e.type == Element.CHORD){
                     var chordEvent = {
                                    "id": chordsAndRests.length,
                                    "type": "note"
                                    };

                     var chordTabs = tabsForSegment(cursor.segment);
                     if (chordTabs.length) {
                         chordEvent.tabs = chordTabs.join(" ");
                     }

                     chordsAndRests.push(chordEvent);
                                    }

                        
                 
                  if (e.type == Element.REST){
                  var restEvent = {
                                    "id": chordsAndRests.length,
                                    "type": "rest"
                                    };

                  var restTabs = tabsForSegment(cursor.segment);
                  if (restTabs.length) {
                      restEvent.tabs = restTabs.join(" ");
                  }

                  chordsAndRests.push(restEvent);
                              
                        
                  }//if element is REST

            }//if element
            cursor.next();
      }//if track didnt end yet

  return chordsAndRests; 
}

function hasForwardTie(chord) {
    if (!chord || !chord.notes) {
        return false;
    }

    for (var i = 0; i < chord.notes.length; ++i) {
        if (chord.notes[i].tieForward) {
            return true;
        }
    }

    return false;
}

function segmentHasStaffTextForTrack(segment, track) {
    if (!segment || !segment.annotations) {
        return false;
    }

    for (var i = 0; i < segment.annotations.length; ++i) {
        var annotation = segment.annotations[i];
        if (annotation && annotation.track === track && annotation.type === Element.STAFF_TEXT) {
            return true;
        }
    }

    return false;
}

function tabsForSegment(segment) {
    var tabs = [];

    if (!segment || !segment.annotations) {
        return tabs;
    }

    for (var i = 0; i < segment.annotations.length; ++i) {
        var annotation = segment.annotations[i];
        if (annotation && annotation.type === Element.STAFF_TEXT && annotation.text) {
            tabs.push(annotation.text);
        }
    }

    return tabs;
}

function tabValueForPitch(pitch, nHoles) {
    var index = pitch - 60;

    if (nHoles === 12) {
        return index >= 0 && index < tabsChromatic.length ? tabsChromatic[index] : null;
    }

    if (nHoles === 10) {
        return index >= 0 && index < tabsDiatonic.length ? tabsDiatonic[index] : null;
    }

    return null;
}

function insertTabs(nHoles) {
    var cursor = curScore.newCursor();
    var inserted = 0;
    var targetTrack = 0;

    curScore.startCmd("Insert tabs");

    cursor.track = targetTrack;
    cursor.rewind(Cursor.SCORE_START);

    while (cursor.segment) {
        var element = cursor.element;

        if (element && element.type === Element.NOTE && element.parent && element.parent.type === Element.CHORD) {
            element = element.parent;
        }

        if (element && element.type === Element.CHORD) {
            if (!hasForwardTie(element) && !segmentHasStaffTextForTrack(cursor.segment, targetTrack)) {
                for (var i = 0; i < element.notes.length; ++i) {
                    var tabValue = tabValueForPitch(element.notes[i].pitch, nHoles);
                    if (!tabValue) {
                        continue;
                    }

                    var staffText = newElement(Element.STAFF_TEXT);
                    staffText.text = tabValue;
                    staffText.placement = Placement.BELOW;
                    cursor.add(staffText);
                    inserted += 1;
                }
            }
        }

        cursor.next();
    }

    curScore.endCmd();

    return inserted;
}

function saveEvents(events) {
    var serialized = JSON.stringify(events, null, 2);

    jsonFile.source = eventsPath();

    if (jsonFile.write(serialized)) {
        console.log("Saved events to " + eventsPath());
        return true;
    }

    console.log("Failed to save events to " + eventsPath());
    return false;
}

function enforceA4PageSettings() {
    if (!curScore || !curScore.style) {
        return false;
    }

    // MuseScore style page dimensions are stored in inches.
    var a4WidthInches = 8.26772;
    var a4HeightInches = 11.6929;
    var oddLeft = Number(curScore.style.value("pageOddLeftMargin"));
    var oddRight = a4WidthInches - Number(curScore.style.value("pagePrintableWidth")) - oddLeft;

    curScore.startCmd("Set page size to A4");
    curScore.style.setValue("pageWidth", a4WidthInches);
    curScore.style.setValue("pageHeight", a4HeightInches);

    if (isFinite(oddLeft) && isFinite(oddRight)) {
        curScore.style.setValue("pagePrintableWidth", a4WidthInches - oddLeft - oddRight);
    }

    curScore.endCmd();
    return true;
}

function tmpPath() {
    return tmpDir;
}

function statusPath() {
    return "/home/andres/harmonica_video_editor/mscore_scripts/status.json";
}

function eventsPath() {
    return tmpPath() + "/events.json";
}

function positionsPath() {
    return tmpPath() + "/positions.spos";
}

function readEvents() {
    jsonFile.source = eventsPath();

    var raw = jsonFile.read();
    if (!raw) {
        console.log("events.json is missing or empty at " + eventsPath());
        return [];
    }

    try {
        var parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
        console.log("Failed to parse events.json: " + err);
        return [];
    }
}

function parsePositionsSpos() {
    positionsFile.source = positionsPath();

    var xml = positionsFile.read();
    if (!xml) {
        console.log("positions.spos is missing or empty at " + positionsPath());
        return {
            elementsById: {},
            events: []
        };
    }

    var elementsById = {};
    var timeline = [];
    var elementRegex = /<element\s+id="([^"]+)"\s+x="([^"]+)"\s+y="([^"]+)"\s+sx="([^"]+)"\s+sy="([^"]+)"\s+page="([^"]+)"\s*\/>/g;
    var eventRegex = /<event\s+elid="([^"]+)"\s+position="([^"]+)"\s*\/>/g;
    var match;

    while ((match = elementRegex.exec(xml)) !== null) {
        var elementId = String(match[1]);
        elementsById[elementId] = {
            x: Number(match[2]),
            y: Number(match[3]),
            sx: Number(match[4]),
            sy: Number(match[5]),
            page: Number(match[6])
        };
    }

    while ((match = eventRegex.exec(xml)) !== null) {
        timeline.push({
            id: String(match[1]),
            time: Number(match[2]) / 1000.0
        });
    }

    return {
        elementsById: elementsById,
        events: timeline
    };
}

function mergeEventsWithPositions() {
    var baseEvents = readEvents();
    var spos = parsePositionsSpos();
    var baseEventsById = {};
    var merged = [];

    for (var i = 0; i < baseEvents.length; ++i) {
        baseEventsById[String(baseEvents[i].id)] = baseEvents[i];
    }

    for (var j = 0; j < spos.events.length; ++j) {
        var timelineEvent = spos.events[j];
        var baseEvent = baseEventsById[timelineEvent.id];
        var elementData = spos.elementsById[timelineEvent.id];

        if (!baseEvent || !elementData) {
            continue;
        }

        var mergedEvent = JSON.parse(JSON.stringify(baseEvent));
        mergedEvent.x = elementData.x / svgDpi;
        mergedEvent.y = elementData.y / svgDpi;
        mergedEvent.w = elementData.sx / svgDpi;
        mergedEvent.h = elementData.sy / svgDpi;
        mergedEvent.page = elementData.page;
        mergedEvent.time = timelineEvent.time;
        merged.push(mergedEvent);
    }

    console.log("Merged " + merged.length + " positioned event(s) from positions.spos");
    return merged;
}

function shiftEventTimes(events, offsetMs) {
    var offsetSeconds = safeMs(offsetMs) / 1000.0;

    for (var i = 0; i < events.length; ++i) {
        events[i].time = Number(events[i].time) + offsetSeconds;
    }

    console.log("Shifted " + events.length + " event time(s) by " + offsetSeconds + " second(s)");
    return events;
}

function countInBeatDurationSeconds() {
    if (!curScore || !curScore.firstMeasure) {
        return 0;
    }

    var denominator = Number(curScore.firstMeasure.timesigActual.denominator);
    var beatsPerSecond = currentTempoBps();
    if (!isFinite(denominator) || denominator <= 0 || !isFinite(beatsPerSecond) || beatsPerSecond <= 0) {
        return 0;
    }

    return (4.0 / denominator) / beatsPerSecond;
}

function buildCountInEvents(offsetMs) {
    if (!curScore || !curScore.firstMeasure) {
        return [];
    }

    var beats = Number(curScore.firstMeasure.timesigActual.numerator);
    var beatDurationSeconds = countInBeatDurationSeconds();
    var offsetSeconds = safeMs(offsetMs) / 1000.0;
    var events = [];

    if (!isFinite(beats) || beats <= 0 || !isFinite(beatDurationSeconds) || beatDurationSeconds <= 0) {
        return events;
    }

    for (var beat = 0; beat < beats; ++beat) {
        events.push({
            time: beat * beatDurationSeconds,
            type: "count",
            count: beat + 1
        });
    }

    events.push({
        time: offsetSeconds,
        type: "count",
        count: 0
    });

    console.log("Built " + events.length + " count-in event(s)");
    return events;
}

function sortEventsByTime(events) {
    events.sort(function(a, b) {
        return Number(a.time) - Number(b.time);
    });

    return events;
}

function defaultStatus() {
    return {
        nHoles: defaultTabHoles,
        jobsDone: 0,
        countInOffset: 0
    };
}

function readStatus() {
    statusFile.source = statusPath();

    var raw = statusFile.read();
    if (!raw) {
        return defaultStatus();
    }

    try {
        var parsed = JSON.parse(raw);
        var base = defaultStatus();

        for (var key in parsed) {
            base[key] = parsed[key];
        }

        return base;
    } catch (err) {
        console.log("Failed to parse status.json: " + err);
        return defaultStatus();
    }
}

function writeStatus(status) {
    statusFile.source = statusPath();
    if (statusFile.write(JSON.stringify(status, null, 2))) {
        console.log("Updated status at " + statusPath());
        return true;
    }

    console.log("Failed to update status at " + statusPath());
    return false;
}

function commitScoreChanges(label) {
    curScore.startCmd(label);
    curScore.endCmd();
}

function firstNoteOrRestInScore() {
    if (!curScore || !curScore.firstMeasure || !curScore.firstMeasure.firstSegment) {
        return null;
    }

    for (var segment = curScore.firstMeasure.firstSegment; segment; segment = segment.next) {
        for (var track = 0; track < curScore.ntracks; ++track) {
            var element = segment.elementAt(track);
            if (!element) {
                continue;
            }

            if (element.type === Element.REST) {
                return element;
            }

            if (element.type === Element.CHORD && element.notes && element.notes.length) {
                return element.notes[0];
            }
        }
    }

    return null;
}

function safeMs(value) {
    var number = Number(value);
    return isFinite(number) ? number : 0;
}

function currentTempoBps() {
    var cursor = curScore.newCursor();
    cursor.rewind(Cursor.SCORE_START);
    var tempo = Number(cursor.tempo);
    return isFinite(tempo) && tempo > 0 ? tempo : 2;
}

function durationToMilliseconds(duration) {
    if (!duration) {
        return 0;
    }

    var beatsPerSecond = currentTempoBps();
    var wholeNotes = Number(duration.numerator) / Number(duration.denominator);
    var quarterNotes = wholeNotes * 4;
    return safeMs((quarterNotes / beatsPerSecond) * 1000);
}

function selectFirstNoteOrRest() {
    var element = firstNoteOrRestInScore();
    if (!element) {
        return null;
    }

    curScore.selection.select(element, false);
    return element;
}

function currentMeasure() {
    var selection = curScore.selection;
    if (!selection || !selection.elements || !selection.elements.length) {
        return null;
    }

    var element = selection.elements[0];
    if (element.measure) {
        return element.measure;
    }

    if (element.parent && element.parent.measure) {
        return element.parent.measure;
    }

    return null;
}

function captureStartingTempoAnnotation() {
    var cursor = curScore.newCursor();
    cursor.rewind(Cursor.SCORE_START);

    var fallbackTempo = Number(cursor.tempo);
    if (!isFinite(fallbackTempo) || fallbackTempo <= 0) {
        fallbackTempo = 2.0;
    }

    if (!curScore || !curScore.firstMeasure || !curScore.firstMeasure.firstSegment) {
        return {
            bpm: Math.round(fallbackTempo * 60),
            tempo: fallbackTempo
        };
    }

    var startTick = curScore.firstMeasure.tick;
    for (var segment = curScore.firstMeasure.firstSegment; segment && segment.tick === startTick; segment = segment.next) {
        if (!segment.annotations) {
            continue;
        }

        for (var i = 0; i < segment.annotations.length; ++i) {
            var annotation = segment.annotations[i];
            if (annotation && annotation.type === Element.TEMPO_TEXT) {
                var extractedTempo = Number(annotation.tempo);
                if (!isFinite(extractedTempo) || extractedTempo <= 0) {
                    extractedTempo = fallbackTempo;
                }

                var extractedBpm = Math.round(extractedTempo * 60);
                console.log("Captured start tempo: text='" + annotation.text + "', tempo=" + extractedTempo + ", bpm=" + extractedBpm);
                return {
                    bpm: extractedBpm,
                    tempo: extractedTempo
                };
            }
        }
    }

    console.log("No start tempo marking found, falling back to cursor tempo=" + fallbackTempo + " (" + Math.round(fallbackTempo * 60) + " bpm)");
    return {
        bpm: Math.round(fallbackTempo * 60),
        tempo: fallbackTempo
    };
}

function removeTempoAnnotationsAtTick(targetTick) {
    if (!curScore || !curScore.firstMeasure) {
        return;
    }

    for (var measure = curScore.firstMeasure; measure; measure = measure.nextMeasure) {
        if (measure.tick !== targetTick) {
            continue;
        }

        for (var segment = measure.firstSegment; segment && segment.tick === targetTick; segment = segment.next) {
            if (!segment.annotations) {
                continue;
            }

            var toRemove = [];
            for (var i = 0; i < segment.annotations.length; ++i) {
                var annotation = segment.annotations[i];
                if (annotation && annotation.type === Element.TEMPO_TEXT) {
                    toRemove.push(annotation);
                }
            }

            for (var j = 0; j < toRemove.length; ++j) {
                removeElement(toRemove[j]);
            }
        }

        return;
    }
}

function applyTempoAnnotationAtScoreStart(annotation) {
    var cursor = curScore.newCursor();
    cursor.rewind(Cursor.SCORE_START);
    cursor.track = 0;

    var tempoText = newElement(Element.TEMPO_TEXT);
    tempoText.text = "<sym>metNoteQuarterUp</sym> = " + annotation.bpm;
    tempoText.tempo = annotation.tempo;
    tempoText.tempoFollowText = false;
    cursor.add(tempoText);
}

function cloneNotes(element) {
    var notes = [];
    if (element.type === Element.REST) {
        return notes;
    }

    for (var i in element.notes) {
        notes.push(element.notes[i].clone());
    }

    return notes;
}

function cloneAnnotations(element) {
    var annotations = [];
    for (var i in element.parent.annotations) {
        var annotation = element.parent.annotations[i];
        if (annotation.track === element.track) {
            annotations.push(annotation.clone());
        }
    }

    return annotations;
}

function cloneArticulations(element) {
    var articulations = [];
    if (element.type === Element.REST) {
        return articulations;
    }

    for (var i in element.articulations) {
        articulations.push(element.articulations[i].clone());
    }

    return articulations;
}

function captureChordRest(element, measureTick) {
    return {
        type: element.type,
        track: element.track,
        startOffset: element.fraction.minus(measureTick),
        duration: element.duration,
        notes: cloneNotes(element),
        annotations: cloneAnnotations(element),
        articulations: cloneArticulations(element),
        beamMode: element.beamMode,
        offsetY: element.type === Element.REST ? element.offsetY : 0,
        visible: element.type === Element.REST ? element.visible : true,
        gap: element.type === Element.REST ? element.gap : false
    };
}

function captureMeasureMaterial(measure, actualEndTick) {
    var material = [];

    for (var segment = measure.firstSegment; segment && segment.tick < actualEndTick; segment = segment.next) {
        for (var track = 0; track < curScore.ntracks; ++track) {
            var element = segment.elementAt(track);
            if (element && (element.type === Element.CHORD || element.type === Element.REST)) {
                material.push(captureChordRest(element, measure.tick));
            }
        }
    }

    return material;
}

function addAnnotations(cursor, annotations) {
    for (var i in cursor.segment.annotations) {
        var existing = cursor.segment.annotations[i];
        if (existing.track === cursor.track) {
            removeElement(existing);
        }
    }

    for (var j in annotations) {
        cursor.add(annotations[j]);
    }
}

function addArticulations(cursor, articulations) {
    for (var i in articulations) {
        cursor.add(articulations[i]);
    }
}

function restoreChordRest(item, baseTick, shift, cursor) {
    var targetTick = baseTick.plus(shift).plus(item.startOffset);
    cursor.track = item.track;
    cursor.rewindToFraction(targetTick);

    var rewindTick = cursor.fraction;
    if (cursor.element) {
        cursor.setDuration(cursor.element.duration.numerator, cursor.element.duration.denominator);
        cursor.addRest();
        cursor.rewindToFraction(rewindTick);
    }

    cursor.setDuration(item.duration.numerator, item.duration.denominator);
    if (item.type === Element.REST) {
        cursor.addRest();
        cursor.rewindToFraction(rewindTick);
        if (cursor.element.duration.equals(cursor.measure.timesigActual)) {
            curScore.selection.select(cursor.element, false);
            cmd("full-measure-rest");
        }
        cursor.rewindToFraction(rewindTick);
        cursor.element.offsetY = item.offsetY;
        cursor.element.visible = item.visible;
        cursor.element.gap = item.gap;
    } else {
        cursor.addNote(item.notes[0].pitch);
        cursor.rewindToFraction(rewindTick);
        var seed = cursor.element.notes[0];
        for (var i in item.notes) {
            cursor.element.add(item.notes[i]);
        }
        removeElement(seed);
        if (!cursor.element.duration.equals(item.duration)) {
            cursor.element.duration = item.duration;
        }
        cursor.rewindToFraction(rewindTick);
        addArticulations(cursor, item.articulations);
    }

    cursor.element.beamMode = item.beamMode;
    addAnnotations(cursor, item.annotations);
}

function restoreMeasureMaterial(material, measureTick, shift) {
    var cursor = curScore.newCursor();
    for (var i in material) {
        restoreChordRest(material[i], measureTick, shift, cursor);
    }
}

function decomposeDuration(duration) {
    var remaining = duration;
    var zero = fraction(0, 1);
    var units = [
        { numerator: 1, denominator: 1 },
        { numerator: 1, denominator: 2 },
        { numerator: 1, denominator: 4 },
        { numerator: 1, denominator: 8 },
        { numerator: 1, denominator: 16 },
        { numerator: 1, denominator: 32 },
        { numerator: 1, denominator: 64 },
        { numerator: 1, denominator: 128 }
    ];
    var parts = [];

    while (remaining.greaterThan(zero)) {
        var matched = false;
        for (var i in units) {
            var unit = fraction(units[i].numerator, units[i].denominator);
            if (!unit.greaterThan(remaining)) {
                parts.push(unit);
                remaining = remaining.minus(unit);
                matched = true;
                break;
            }
        }

        if (!matched) {
            break;
        }
    }

    return parts;
}

function insertGapRests(measureTick, addedDuration) {
    var parts = decomposeDuration(addedDuration);
    var cursor = curScore.newCursor();

    for (var staff = 0; staff < curScore.nstaves; ++staff) {
        var tick = measureTick;
        cursor.track = staff * 4;
        for (var i in parts) {
            cursor.rewindToFraction(tick);
            cursor.setDuration(parts[i].numerator, parts[i].denominator);
            cursor.addRest();
            tick = tick.plus(parts[i]);
        }
    }
}

function syncActualToNominalTimeSig() {
    var measure = currentMeasure();
    if (!measure) {
        throw new Error("No current measure");
    }

    if (measure.timesigActual.equals(measure.timesigNominal)) {
        return {
            message: "Actual already matches nominal",
            countInOffset: 0
        };
    }

    var startTick = measure.tick.ticks;
    var oldActual = measure.timesigActual;
    var nominal = measure.timesigNominal;
    var addedDuration = nominal.minus(oldActual);
    var endTick = startTick + oldActual.ticks;
    var material = captureMeasureMaterial(measure, endTick);

    curScore.selection.selectRange(startTick, endTick, 0, curScore.nstaves);
    cmd("notation-cut");

    curScore.startCmd("Sync actual time signature");
    measure.timesigActual = nominal;

    if (addedDuration.greaterThan(fraction(0, 1))) {
        insertGapRests(measure.tick, addedDuration);
    }

    restoreMeasureMaterial(material, measure.tick, addedDuration);
    curScore.endCmd();
    commitScoreChanges("Commit pickup sync");

    return {
        message: "Pickup expanded to nominal",
        offsetMs: durationToMilliseconds(addedDuration)
    };
}

function insertCountIn() {
    if (!curScore) {
        throw new Error("No score is open");
    }

    var element = selectFirstNoteOrRest();
    if (!element) {
        throw new Error("No note or rest found");
    }

    var measure = currentMeasure();
    if (!measure) {
        throw new Error("No current measure");
    }

    if (measure.timesigActual.equals(measure.timesigNominal)) {
        var startingTempoAnnotation = captureStartingTempoAnnotation();
        cmd("insert-measure");
        commitScoreChanges("Commit inserted count-in");
        curScore.startCmd("Set count-in tempo");
        if (curScore.firstMeasure && curScore.firstMeasure.nextMeasure) {
            removeTempoAnnotationsAtTick(curScore.firstMeasure.nextMeasure.tick);
        }
        applyTempoAnnotationAtScoreStart(startingTempoAnnotation);
        curScore.endCmd();
        var fullMeasureDuration = fraction(measure.timesigNominal.numerator, measure.timesigNominal.denominator);
        return {
            message: "Inserted one full count-in measure",
            offsetMs: durationToMilliseconds(fullMeasureDuration)
        };
    }

    if (measure.timesigActual.lessThan(measure.timesigNominal)) {
        return syncActualToNominalTimeSig();
    }

    throw new Error("Count-in unsupported: actual exceeds nominal");
}

function metronomePart() {
    if (!curScore || !curScore.parts) {
        return null;
    }

    for (var i = 0; i < curScore.parts.length; ++i) {
        if (curScore.parts[i].instrumentId === "wood-blocks") {
            return curScore.parts[i];
        }
    }

    return null;
}

function ensureMetronomePart() {
    var part = metronomePart();
    if (part) {
        return part;
    }

    curScore.appendPart("wood-blocks");
    part = metronomePart();
    if (!part) {
        throw new Error("Failed to append metronome part");
    }

    return part;
}

function configureMetronomePart(part) {
    if (!part || !part.instruments || !part.instruments.length) {
        return;
    }

    var instrument = part.instruments[0];
    if (!instrument.channels || !instrument.channels.length) {
        return;
    }

    for (var i = 0; i < instrument.channels.length; ++i) {
        instrument.channels[i].reverb = 0;
        instrument.channels[i].chorus = 0;
    }
}

function writeMetronomeMeasure(cursor, measure, track) {
    var denominator = measure.timesigActual.denominator;
    var beats = measure.timesigActual.numerator;
    var tick = measure.tick;

    cursor.track = track;
    cursor.voice = 0;

    for (var beat = 0; beat < beats; ++beat) {
        cursor.rewindToFraction(tick);
        cursor.setDuration(1, denominator);
        cursor.addNote(beat === 0 ? 77 : 76);
        tick = tick.plus(fraction(1, denominator));
    }
}

function addMetronomeTrack() {
    if (!curScore || !curScore.firstMeasure) {
        throw new Error("No score is open");
    }

    var part = ensureMetronomePart();
    configureMetronomePart(part);
    var cursor = curScore.newCursor();
    var measureCount = 0;

    curScore.startCmd("Add metronome track");
    for (var measure = curScore.firstMeasure; measure; measure = measure.nextMeasure) {
        writeMetronomeMeasure(cursor, measure, part.startTrack);
        measureCount += 1;
    }
    curScore.endCmd();
    commitScoreChanges("Commit metronome track");

    return measureCount;
}

onRun: {
    try {
        var status = readStatus();

        if (status.jobsDone === 0) {
            if (enforceA4PageSettings()) {
                console.log("Forced page settings to A4");
            }

            var insertedTabs = insertTabs(status.nHoles || defaultTabHoles);
            console.log("Inserted " + insertedTabs + " tab(s)");

            var chordsAndRests = getChordsAndRests();
            if (!saveEvents(chordsAndRests)) {
                return;
            }

            status.jobsDone = 1;
            writeStatus(status);
            return;
        }

        if (status.jobsDone === 1) {
            status.jobsDone = 2;
            writeStatus(status);
            return;
        }

        if (status.jobsDone === 2) {
            var mergedEvents = mergeEventsWithPositions();
            var countInResult = insertCountIn();
            var metronomeMeasures = addMetronomeTrack();
            commitScoreChanges("Commit count-in and metronome");
            var offsetMs = safeMs(countInResult.offsetMs);
            if (mergedEvents.length) {
                var shiftedEvents = shiftEventTimes(mergedEvents, offsetMs);
                var countEvents = buildCountInEvents(offsetMs);
                saveEvents(sortEventsByTime(countEvents.concat(shiftedEvents)));
            }
            console.log(countInResult.message + ", metronome track written for " + metronomeMeasures + " measure(s), count-in offset: " + offsetMs + " ms");

            status.countInOffset = offsetMs;
            status.jobsDone = 3;
            writeStatus(status);
            return;
        }

        console.log("No status transition for jobsDone=" + status.jobsDone);
    } catch (err) {
        console.log("new.qml failed: " + err);
    }
}




}
