

#ifndef HARMONICA
#define HARMONICA


#include <QQuickItem>
#include <QJsonDocument>
#include <QJsonObject>
#include <QJsonArray>
#include <QJsonValue>
#include <QFile>
#include <QString>
#include <QTextStream>
#include <QApplication>
#include <vector>
#include "appfactory.h"
#include "global/iapplication.h"
#include "global/io/file.h"
#include "global/io/dir.h"
#include "modularity/ioc.h"
#include "actions/iactionsdispatcher.h"
#include "context/iglobalcontext.h"
#include "global/iapplication.h"
#include "project/iprojectcreator.h"
#include "converter/iconvertercontroller.h"
#include "converter/convertercodes.h"
#include "project/inotationwritersregister.h"
#include "playback/iplaybackcontroller.h"
#include "notation/inotationconfiguration.h"
//#include "engraving/playback/playbackeventsrenderer.h"
#include "project/inotationproject.h"
#include "engraving/dom/masterscore.h"
#include "engraving/dom/repeatlist.h"
#include "engraving/dom/lyrics.h"
#include "engraving/dom/factory.h"
#include "engraving/dom/instrtemplate.h"
#include "engraving/dom/measure.h"
#include "engraving/dom/score.h"
#include "engraving/dom/segment.h"
#include "engraving/dom/text.h"
#include "engraving/dom/property.h"
#include "engraving/dom/undo.h"
#include "engraving/dom/stafftext.h"
#include "engraving/dom/tempo.h"
#include "engraving/dom/sig.h"

using namespace mu::engraving;


class Harmonica: public muse::Injectable
{


public:
    Harmonica(int n_holes, double default_tempo, const QString& folderPath,
              bool updateEventsJson = true, bool updateScoreSvgs = true,
              bool updateHarmonicaAudio = true, bool updateMetronomeAudio = true,
              bool updateAccompanimentAudio = true);
    muse::Inject<mu::context::IGlobalContext> context = { this };
    muse::Inject<mu::project::IProjectCreator> notationCreator = { this };
    muse::Inject<mu::project::INotationWritersRegister> writers = { this };
    muse::Inject<mu::converter::IConverterController> converter;
    muse::Inject<mu::playback::IPlaybackController> playbackController  = { this };
    muse::Inject<mu::notation::INotationConfiguration> configuration = { this };

    struct countEvent {
    double time;
    int count;
    QString toJsonString() const {
        QString json = "{\n";
        json += "  \"time\": " + QString::number(time) + ",\n";
        json += "  \"type\": \"count\",\n";
        json += "  \"count\": " + QString::number(count) + "\n";
        json += "}";
        return json;
    }
    };

        struct hEvent {
    int x;
    int y;
    double w;
    double h;
    int page;
    double time;
    QString tabs;

        // Convert hEvent struct to QJsonObject
    QString toJsonString() const {
        QString json = "{\n";
        json += "  \"time\": " + QString::number(time) + ",\n";
        if (!tabs.isEmpty()) {
            json += "  \"type\": \"note\",\n";
            json += "  \"tabs\": \"" + tabs + "\",\n";
        } else {
            json += "  \"type\": \"rest\",\n";
        }
        json += "  \"x\": " + QString::number(x) + ",\n";
        json += "  \"y\": " + QString::number(y) + ",\n";
        json += "  \"w\": " + QString::number(w) + ",\n";
        json += "  \"h\": " + QString::number(h) + ",\n";
        json += "  \"page\": " + QString::number(page) + "\n";
        
        // Add the "tabs" field only if it's not empty

        json += "}";
        return json;
    }
    };
    const QString tabs_chromatic[40] = {"1", "1*", "-1", "-1*", "2", "-2", "-2*", "3", "3*", "-3", "-3*", "-4", "5", "5*", "-5", "-5*", "6", "-6", "-6*", "7", "7*", "-7", "-7*", "-8", "9", "9*", "-9", "-9*", "10", "-10", "-10*", "11", "11*", "-11", "-11*", "-12", "12", "12*", "-12*"};


    const QString tabs_diatonic[38] = { "1", "-1’", "-1", "na", "2", "-2''", "-2’", "3", "-3'''", "-3''", "-3'", "-3", "4", "-4'", "-4", "na", "5", "-5", "na", "6", "-6'", "-6", "na", "-7", "7", "na", "-8", "8’", "8", "-9", "9’", "9", "na", "-10", "10’’", "10’", "10" };
    std::vector<hEvent> events;  
    std::vector<countEvent> countEvents;  
    mu::project::INotationProjectPtr notationProject;
    mu::notation::IMasterNotationPtr masterNotation;
    mu::notation::INotationPtr notation;
    mu::engraving::Score * score;
    mu::engraving::MasterScore * masterScore;
    std::vector<Part*> parts;
    InstrumentTrackId harmonicaId;
    InstrumentTrackId accompanimentId;
    InstrumentTrackId metronomeId;
    muse::audio::AudioOutputParams harmonicaParams;
    muse::audio::AudioOutputParams accompanimentParams;
    mu::project::IProjectAudioSettingsPtr audioSettings;
    mu::notation::INotationPlaybackPtr notationPlayback;
    
    bool hasAccompaniment = false;
    int n_holes;
    double default_tempo;
    String folder;
    
    
    void exportMp3s(bool harm, bool accom, bool metro);
    void exportMp3(bool harm, bool accom, bool metro,const muse::io::path_t& out);
    void exportSVGs();
    void exportPNGs();
    void exportEvents();
    void extractPositions();
    void shiftEventsTime(double time_shift);
    double insertCountIn();
    void createCountInEvents();
    void removeTitle();
    void insertTabs();
    bool writeScore(const QString& name, const QString& ext);
    int writeEventsJson();
    muse::Ret convertPageByPage(project::INotationWriterPtr writer, const muse::io::path_t& out) const;
    muse::Ret convertFullNotation(project::INotationWriterPtr writer, const muse::io::path_t& out) const;

};




#endif
