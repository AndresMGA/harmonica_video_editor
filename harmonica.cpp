

#include "harmonica.h"

#include <chrono>
#include <iostream>

#ifdef Q_OS_WASM
#include <emscripten/bind.h>
#include <emscripten/val.h>
#endif

using namespace mu::engraving;
using namespace mu::converter;
using namespace mu::project;
using namespace mu::notation;
using namespace muse;
using namespace muse::io;
using namespace mu::app;
//usage
// Harmonica(12, 100, "/tmp/output", true, true, true, true, true)
Harmonica::Harmonica(int n_holes, double default_tempo, const QString& folderPath,
                     bool updateEventsJson, bool updateScoreSvgs,
                     bool updateHarmonicaAudio, bool updateMetronomeAudio,
                     bool updateAccompanimentAudio){
    
    this->n_holes=n_holes;

    auto start = std::chrono::high_resolution_clock::now(); // Start timing
    this->default_tempo = default_tempo;
    this->folder = String::fromQString(folderPath);

    //auto* qapp = QApplication::instance();
    //CmdOptions options;
    //options.exportImage.pngDpiResolution = 150;
/*     options.runMode = IApplication::RunMode::ConsoleApp;
    AppFactory f;
    std::shared_ptr<muse::IApplication> app = f.newApp(options);
    app->perform(); */
       
    
    std::cout << "Harmonica created" << std::endl;
    notationProject = notationCreator()->newProject(iocContext());
    notationProject->load(folder + String("/song.mscz"), "", false);
    std::cout << "Song loaded" << std::endl;
    configuration()->setIsMetronomeEnabled(true);
    std::cout << "Metronome loaded" << std::endl;
    context()->setCurrentProject(notationProject);
    std::cout << "current project set" << std::endl;
    masterNotation = notationProject->masterNotation();
    score = masterNotation->masterScore();
    masterScore = masterNotation->masterScore();
    notation = masterNotation->notation();
   
    
    
    notationPlayback = context()->currentProject()->masterNotation()->playback();
    parts = score->parts();
    
    harmonicaId = parts[0]->instrumentTrackIdList()[0];
    if(parts.size()>1)
    {
        accompanimentId = parts[1]->instrumentTrackIdList()[0];
        hasAccompaniment = true;
    }
    else{
        hasAccompaniment = false;   
        }

    metronomeId = notationPlayback->metronomeTrackId();
    audioSettings = notationProject->audioSettings();
    notation->undoStack()->prepareChanges(TranslatableString("undoableAction", "Plugin edit"));
    //std::cout << "Settings done" << std::endl;
    if (default_tempo>0){
    score->setUpTempoMap();
    score->tempomap()->setTempo(
        score->firstMeasure()->tick().ticks(), 
        BeatsPerSecond(default_tempo/60.));
    score->update();
    masterScore->update();
    }
   
    removeTitle();
    insertTabs();
    std::cout << "all done start exporting" << std::endl;

    if (updateScoreSvgs) {
        exportSVGs();
        std::cout << "svg exported" << std::endl;
    }

    const bool needsCountInArtifacts = updateEventsJson
                                       || updateHarmonicaAudio
                                       || updateMetronomeAudio
                                       || (updateAccompanimentAudio && hasAccompaniment);

    if (needsCountInArtifacts) {
        extractPositions();
        const double countInOffset = insertCountIn();
        createCountInEvents();
        shiftEventsTime(countInOffset);

        if (updateEventsJson) {
            writeEventsJson();
        }
    }

    notation->undoStack()->commitChanges();
    notation->notationChanged().notify();
    if (updateHarmonicaAudio || updateMetronomeAudio || (updateAccompanimentAudio && hasAccompaniment)) {
        exportMp3s(updateHarmonicaAudio, updateAccompanimentAudio, updateMetronomeAudio);
    }
   
    //convertFullNotation(writers()->writer("mid"), folder +String("/score.mid"));
    
    //app->finish();
    //delete qapp;

    auto end = std::chrono::high_resolution_clock::now(); // End timing
    auto duration = std::chrono::duration_cast<std::chrono::milliseconds>(end - start).count();

    std::cout << "Execution time: " << duration << " ms" << std::endl;
}
void Harmonica::removeTitle(){

    EngravingObjectList eol =
    score->scanChildren().at(0) // first Page
    ->scanChildren().at(0) // first System
    ->scanChildren().at(0) // first VBox
    ->scanChildren(); 
    for (size_t eo=0;eo<eol.size();eo++){
       
         if (strcmp(eol.at(eo)->typeName(), "Text") == 0){
            
           Text * title = static_cast<mu::engraving::Text *>(eol.at(eo));
           //std::cout<<title->plainText().toStdString()<<std::endl;
           score->undoRemoveElement(title);
           score->update();
           masterScore->update();
           
            } 
    } 
    
}
void Harmonica::exportMp3s(bool harm, bool accom, bool metro){

    harmonicaParams = audioSettings->trackOutputParams(harmonicaId);   
    if (hasAccompaniment) {
        accompanimentParams = audioSettings->trackOutputParams(accompanimentId);
    }

    if (metro) {
        exportMp3(false, false, true, folder + String("/metronome.mp3"));
    }
    if (harm) {
        exportMp3(true, false, false, folder + String("/harmonica.mp3"));
    }
    if (accom && hasAccompaniment) {
        exportMp3(false, true, false, folder +String("/accompaniment.mp3"));
    }

}
void Harmonica::exportMp3(bool harm, bool accom, bool metro,const muse::io::path_t& out) {
    playbackController()->setTrackSoloMuteState(metronomeId, {!metro, metro});
    playbackController()->setTrackSoloMuteState(harmonicaId, {!harm, harm});
    if(hasAccompaniment)
        playbackController()->setTrackSoloMuteState(accompanimentId, {!accom, accom});
    
 
    harmonicaParams.volume = metro ? -120 : 0;
    if(hasAccompaniment)
        accompanimentParams.volume = metro ? -120 : 0;


    audioSettings->setTrackOutputParams(harmonicaId, harmonicaParams);
    if(hasAccompaniment)
        audioSettings->setTrackOutputParams(accompanimentId, accompanimentParams);
  

    
    auto writer = writers()->writer("mp3");
    convertFullNotation(writer, out);
   
}
void Harmonica::exportSVGs(){
    auto writer = writers()->writer("svg");
    convertPageByPage(writer, folder +String("/score.svg"));
}
void Harmonica::exportPNGs(){
    auto writer = writers()->writer("png");
    convertPageByPage(writer, folder +String("/score.png"));
}
void Harmonica::exportEvents(){
    //std::cout << "Exporting events.json" << std::endl;
} 
bool Harmonica::writeScore(const QString& name, const QString& ext)
{
    
    muse::io::path_t out(name+"."+ext);
    //auto notationProject = context()->currentProject(); 
    std::string suffix = ext.toStdString();
    if (suffix == "mscz" || suffix == "mscx" || suffix == "mscs") {
            return notationProject->save(out);
        }
    return false;
}
void Harmonica::extractPositions()
{
    
    QString result;
    
    score->masterScore()->updateRepeatList();
    score->masterScore()->setExpandRepeats(true);

    
    for (const mu::engraving::RepeatSegment *repeatSegment : score->repeatList())
    {
        int startTick = repeatSegment->tick;
        int endTick = startTick + repeatSegment->len();
        int tickOffset = repeatSegment->utick - repeatSegment->tick;

        for (mu::engraving::Measure *measure = score->tick2measureMM(Fraction::fromTicks(startTick)); measure; measure = measure->nextMeasureMM())
        {
            
            for (mu::engraving::Segment *s = measure->first(mu::engraving::SegmentType::ChordRest); s;
                 s = s->next(mu::engraving::SegmentType::ChordRest))
            {  
                mu::engraving::EngravingItem *e = s->element(0);
                
                if (!e)continue;

                qreal sx = 0;
                sx = qMax(sx, e->width());
               
                qreal sy = s->measure()->system()->height();
                int x = s->pagePos().x();
                int y = s->pagePos().y();

                mu::engraving::Page *page = s->measure()->system()->page();
                mu::engraving::page_idx_t pageIndex = score->pageIdx(page);
                QString lyrics;
                if (strcmp(e->typeName(), "Chord") == 0)
                {
                    mu::engraving::Chord *c = static_cast<mu::engraving::Chord *>(e);
                    if (c->nextTiedChord(true))
                    {
                        //tied = true;
                    }
                    else
                    {
                        std::vector<StaffText*> tabs;
                        EngravingObjectList eol =s->scanChildren();
                        for (size_t eo=0;eo<eol.size();eo++){
                        if (strcmp(eol.at(eo)->typeName(), "StaffText") == 0){
                            tabs.push_back(
                            static_cast<mu::engraving::StaffText *>(eol.at(eo)));
                        }
                    } 

                        for (const auto tab : tabs)
                        {
                            QString qlyric = tab->plainText().toQString();
                            lyrics += qlyric+" ";
                        }
                        if (!lyrics.isEmpty())
                        {
                            lyrics.resize(lyrics.size() - 1);
                        }
                        
                    }

                  
                }
                int tick = s->tick().ticks() + tickOffset;
                double time = score->repeatList().utick2utime(tick);
                
                hEvent ev;
                ev.x = x;   
                ev.y = y;
                ev.w = sx;
                ev.h = sy;
                ev.page = pageIndex;
                ev.time = time;
                ev.tabs = lyrics;
                events.push_back(ev);
            }

            if (measure->endTick().ticks() >= endTick)
            {
                break;
            }
        }
    }


    score->masterScore()->setExpandRepeats(false);

}
void Harmonica::insertTabs()
{
    score->masterScore()->updateRepeatList();
    score->masterScore()->setExpandRepeats(false);

    
    for (const mu::engraving::RepeatSegment *repeatSegment : score->repeatList())
    {
        int startTick = repeatSegment->tick;
        int endTick = startTick + repeatSegment->len();
       
        for (mu::engraving::Measure *measure = score->tick2measureMM(Fraction::fromTicks(startTick)); measure; measure = measure->nextMeasureMM())
        {
           
            for (mu::engraving::Segment *s = measure->first(mu::engraving::SegmentType::ChordRest); s;
                 s = s->next(mu::engraving::SegmentType::ChordRest))
            {   

                
                mu::engraving::EngravingItem *e = s->element(0);
                if (!e)continue;

                if (strcmp(e->typeName(), "Chord") == 0)
                {
                    mu::engraving::Chord *c = static_cast<mu::engraving::Chord *>(e);
                    std::vector<StaffText*> alreadyPresentTabs;
                    EngravingObjectList eol =s->scanChildren();
                    for (size_t eo=0;eo<eol.size();eo++){
                        if (strcmp(eol.at(eo)->typeName(), "StaffText") == 0){
                            alreadyPresentTabs.push_back(
                                static_cast<mu::engraving::StaffText *>(eol.at(eo)));
                        }
                    } 


                    if (c->nextTiedChord(true))
                    {
                        //tied = true;
                    }
                    else if (alreadyPresentTabs.size()==0)
                    {
                        for (size_t i=0;i<c->notes().size();i++)
                        {
                            
                          
                            int pitch = c->notes().at(i)->pitch();
                            String tabStr = n_holes>10?String::fromQString(tabs_chromatic[pitch-60]):String::fromQString(tabs_diatonic[pitch-60]);
                            StaffText* tab = Factory::createStaffText(s);
                            tab->setScore(score);
                            tab->setTrack(c->track());
                            //tab->setSegment(s);
                            tab->setParent(s);
                            tab->setPlainText(tabStr);
                            tab->setPlacement(PlacementV::BELOW);
                            tab->setPropertyFlags(Pid::PLACEMENT, PropertyFlags::UNSTYLED);
                            score->undoAddElement(tab);
                        }
                    }
                }
                
            }

            if (measure->endTick().ticks() >= endTick)
            {
                break;
            }
        }
    }
    score->masterScore()->setExpandRepeats(false);
    score->update();
}
double Harmonica::insertCountIn() { 
    
    mu::engraving::Measure* firstMeasure = score->firstMeasure();
    mu::engraving::MasterScore* ms = score->masterScore();
    const size_t msTracks = ms->ntracks();
    
    mu::engraving::Segment *seg = firstMeasure->first(mu::engraving::SegmentType::ChordRest);
    
    const mu::engraving::Fraction len       = firstMeasure->anacrusisOffset();
    const mu::engraving::Fraction tick      = seg->tick();
    const mu::engraving::Fraction targetMeasureLen = firstMeasure->ticks() + len;
    int anacrusisTicks = firstMeasure->anacrusisOffset().ticks();
    
   // std::cout<< score->utick2utime(anacrusisTicks) << std::endl;
    
    //double anacrusisTempo = score->tempo(tick).val;
    double anacrusisTempoBPM = score->tempo(tick).toBPM().val;
    //std::cout<< score->tempo(tick).toBPM().val << std::endl;
   // std::cout<< bps.toBPM().val << std::endl;
    if (anacrusisTicks>0){
    score->undoInsertTime(tick, len);
    score->undo(new ChangeMeasureLen(firstMeasure, targetMeasureLen));
    }
    else{
        
        mu::engraving::Score::InsertMeasureOptions options;
        anacrusisTicks =ms->insertMeasure(firstMeasure,options)->ticks().ticks();
        
    }
    score->setUpTempoMap();
    for (mu::engraving::Segment* s = seg; s; s = s->next()) {
            s->undoChangeProperty(Pid::TICK, s->rtick() + len);
        }
    
    for (mu::engraving::track_idx_t track = 0; track < msTracks; ++track) {
        ms->setRest(tick, track, len, /* useDots */ false, /* tuplet */ nullptr);
    }
    if(default_tempo>0)anacrusisTempoBPM = default_tempo;
    score->setTempo(mu::engraving::Fraction(0,1), BeatsPerSecond(anacrusisTempoBPM/60.));
    

    double anacrusisTime = score->utick2utime(anacrusisTicks);
    score->update();
    masterScore->update();
    masterScore->rebuildMidiMapping();
    return anacrusisTime;
}
void Harmonica::createCountInEvents(){
        mu::engraving::Measure* firstMeasure = score->firstMeasure();
        int measureStartTick = firstMeasure->tick().ticks();
        int measureEndTick = firstMeasure->endTick().ticks();
        TimeSigFrac timeSignatureFraction = score->sigmap()->timesig(measureStartTick).timesig();
        BeatsPerSecond bps = score->tempomap()->tempo(measureStartTick);
        

        int step = timeSignatureFraction.isBeatedCompound(bps.val)
               ? timeSignatureFraction.beatTicks() : timeSignatureFraction.dUnitTicks();
        
        int count = 0;
        for (int tick = measureStartTick; tick < measureEndTick; tick += step) {
        double time = score->repeatList().utick2utime(tick);
        countEvent ev;
        ev.time = time;     
        ev.count = ++count;
        countEvents.push_back(ev);
    }

    

    double countEndTime = score->repeatList().utick2utime(measureEndTick);
    countEvent ev;
    ev.time = countEndTime;
    ev.count = 0;
    countEvents.push_back(ev);
       
           
        
    
}
void  Harmonica::shiftEventsTime(double time_shift){
    
    for ( hEvent &ev : events) {
         ev.time+=time_shift;
        }

}
int Harmonica::writeEventsJson() {
   

    // Start building the JSON array string
    QString jsonString = "[\n";

    // Append each countevenT's JSON string
    for (size_t i = 0; i < countEvents.size(); ++i) {
        jsonString += countEvents[i].toJsonString();
        jsonString += ",\n"; // Add a comma after each element
        

    }

    // Append each event's JSON string
    for (size_t i = 0; i < events.size(); ++i) {
        jsonString += events[i].toJsonString();
        if (i != events.size() - 1) {
            jsonString += ",\n"; // Add a comma after each element, except the last
        }
    }

    // Close the JSON array
    jsonString += "\n]";

    // Create and open the file
    QFile file(folder +String("/events.json"));
    if (!file.open(QIODevice::WriteOnly | QIODevice::Text)) {
        qDebug() << "Could not open file for writing!";
        return -1;
    }

    // Write the JSON string to the file
    QTextStream out(&file);
    out << jsonString;

    // Close the file
    file.close();
  



    qDebug() << "Data has been written to events.json";

    return 0;
}
muse::Ret Harmonica::convertPageByPage(mu::project::INotationWriterPtr writer,  const muse::io::path_t& out) const
{
    TRACEFUNC;

    for (size_t i = 0; i < notation->elements()->pages().size(); i++) {
        const String filePath = muse::io::path_t(io::dirpath(out) + "/"
                                                 + io::completeBasename(out) + "-%1."
                                                 + io::suffix(out)).toString().arg(i + 1);

        File file(filePath);
        if (!file.open(File::WriteOnly)) {
            return make_ret(Err::OutFileFailedOpen);
        }

        INotationWriter::Options options = {
            { INotationWriter::OptionKey::PAGE_NUMBER, Val(static_cast<int>(i)) },
        };

        file.setMeta("dir_path", out.toStdString());
        file.setMeta("file_path", filePath.toStdString());

        Ret ret = writer->write(notation, file, options);
        if (!ret) {
            LOGE() << "failed write, err: " << ret.toString() << ", path: " << out;
            return make_ret(Err::OutFileFailedWrite);
        }

        file.close();
   
    }

    return make_ret(Ret::Code::Ok);
}
muse::Ret Harmonica::convertFullNotation(mu::project::INotationWriterPtr writer, const muse::io::path_t& out) const
{
    File file(out);
    if (!file.open(File::WriteOnly)) {
        return make_ret(Err::OutFileFailedOpen);
    }

    file.setMeta("file_path", out.toStdString());
    //std::cout << "try write" << std::endl;
    Ret ret = writer->write(notation, file);
    //std::cout << "written" << std::endl;
    if (!ret) {
        LOGE() << "failed write, err: " << ret.toString() << ", path: " << out;
        return make_ret(Err::OutFileFailedWrite);
    }

    file.close();
   

    return make_ret(Ret::Code::Ok);
}
