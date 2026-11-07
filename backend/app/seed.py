"""Initial demonstration dataset: a FICTIONAL mission and crew with SIMULATED history."""
from datetime import timedelta

import numpy as np
from sqlalchemy import select
from sqlalchemy.orm import Session

from .alerting import log_event
from .baselines import compute_baselines
from .db import Base, L, engine, utcnow
from .metrics import VITALS, put_setting
from .models import Astronaut, DataSource, EmergencyProtocol, MedicalResource, Mission
from .nasa import DONKI_FALLBACK, DONKI_PRIMARY, OSDR_META, OSDR_STUDIES
from .simulation import generate_env_history, generate_history

CREW = [
    {"code": "AST-01", "name": "Elena Varga", "role": "Commander", "age": 44, "sex": "F", "mass_kg": 63.0},
    {"code": "AST-02", "name": "Kenji Mori", "role": "Crew Medical Officer", "age": 41, "sex": "M", "mass_kg": 74.5},
    {"code": "AST-03", "name": "Amara Okafor", "role": "Mission Specialist", "age": 36, "sex": "F", "mass_kg": 61.0},
    {"code": "AST-04", "name": "Lucas Ferreira", "role": "Flight Engineer", "age": 39, "sex": "M", "mass_kg": 79.0},
]

RESOURCES = [
    (L("Automated external defibrillator (AED)", "Desfibrilador externo automático (DEA)"), "equipment", ["cardiovascular"], 1, "unit", "Node 1 · medical rack"),
    (L("ECG-capable vital signs monitor", "Monitor de sinais vitais com ECG"), "equipment", ["cardiovascular", "respiratory", "general"], 1, "unit", "Node 1 · medical rack"),
    (L("Pulse oximeter", "Oxímetro de pulso"), "equipment", ["respiratory", "environmental", "cardiovascular", "general"], 2, "units", "Medical kit A"),
    (L("Blood pressure cuff (automatic)", "Esfigmomanômetro automático"), "equipment", ["cardiovascular", "general"], 2, "units", "Medical kit A"),
    (L("Supplemental oxygen supply", "Suprimento de oxigênio suplementar"), "consumable", ["respiratory", "environmental", "cardiovascular"], 3, "bottles", "Habitat · O2 port"),
    (L("IV fluid administration kit", "Kit de administração de fluidos IV"), "consumable", ["cardiovascular", "fatigue", "general"], 4, "kits", "Medical kit B"),
    (L("Ambulatory medical pack (general)", "Kit médico ambulatorial (geral)"), "kit", ["general", "cardiovascular", "fatigue", "environmental", "respiratory"], 1, "pack", "Crew quarters"),
    (L("Cognitive test station (tablet)", "Estação de teste cognitivo (tablet)"), "equipment", ["fatigue"], 1, "unit", "Workstation 2"),
    (L("Portable CO2 / O2 monitor", "Monitor portátil de CO2 / O2"), "equipment", ["environmental", "respiratory"], 2, "units", "Habitat · ECLSS bay"),
    (L("CO2 scrubber spare cartridges", "Cartuchos reserva do filtro de CO2"), "consumable", ["environmental"], 6, "cartridges", "ECLSS bay"),
    (L("Telemedicine kit (ultrasound + camera)", "Kit de telemedicina (ultrassom + câmera)"), "equipment", ["general", "cardiovascular", "respiratory"], 1, "kit", "Node 1"),
]

EDU = L("EDUCATIONAL DEMONSTRATION CONTENT — not certified medical instructions.",
        "CONTEÚDO EDUCACIONAL DE DEMONSTRAÇÃO — não são instruções médicas certificadas.")


def _steps(*pairs):
    return [L(en, pt) for en, pt in pairs]


PROTOCOLS = [
    ("PROT-CARDIO", "cardiovascular", L("Cardiovascular indicator changes — demo checklist", "Alterações cardiovasculares — checklist de demonstração"), _steps(
        ("Stop the current task; have the crew member rest in a stable, secured position.", "Interromper a tarefa; manter o tripulante em repouso em posição estável e presa."),
        ("Call the crew medical officer and stay with the crew member.", "Chamar o oficial médico e permanecer com o tripulante."),
        ("Repeat heart rate, blood pressure and SpO2 with the ECG-capable monitor.", "Repetir frequência cardíaca, pressão e SpO2 com o monitor com ECG."),
        ("Bring the AED to the location and confirm it is ready.", "Levar o DEA ao local e confirmar a prontidão."),
        ("Record symptoms, times and every action in the RESCUE WINDOW log.", "Registrar sintomas, horários e cada ação no log da RESCUE WINDOW."),
        ("Contact the ground medical team when the link allows; send the event summary.", "Contatar a equipe médica em solo quando o link permitir; enviar o resumo do evento."),
    )),
    ("PROT-RESP", "respiratory", L("Low SpO2 reading — demo checklist", "Leitura baixa de SpO2 — checklist de demonstração"), _steps(
        ("Check sensor placement and repeat the reading on a second oximeter.", "Verificar o sensor e repetir a leitura em um segundo oxímetro."),
        ("Cross-check cabin O2 and CO2 readings.", "Conferir as leituras de O2 e CO2 da cabine."),
        ("Call the crew medical officer for assessment.", "Chamar o oficial médico para avaliação."),
        ("Prepare the supplemental oxygen supply per the crew's trained procedure.", "Preparar o oxigênio suplementar conforme o procedimento treinado."),
        ("Log all readings and actions.", "Registrar todas as leituras e ações."),
    )),
    ("PROT-FATIGUE", "fatigue", L("Fatigue and cognitive decline — demo checklist", "Fadiga e queda cognitiva — checklist de demonstração"), _steps(
        ("Review the crew member's schedule; consider pausing safety-critical tasks (EVA, robotics, docking).", "Revisar a agenda; considerar pausar tarefas críticas (EVA, robótica, acoplagem)."),
        ("Ask the crew medical officer to assess the crew member.", "Pedir ao oficial médico para avaliar o tripulante."),
        ("Check sleep environment factors: light, noise, temperature, CO2.", "Verificar fatores do ambiente de sono: luz, ruído, temperatura, CO2."),
        ("Plan a protected rest period and log fluid intake.", "Planejar um período de descanso protegido e registrar a ingestão de líquidos."),
        ("Repeat the cognitive assessment after rest and compare with the personal baseline.", "Repetir a avaliação cognitiva após o descanso e comparar com a linha de base."),
    )),
    ("PROT-ATMOS", "environmental", L("Cabin atmosphere anomaly (CO2 / O2) — demo checklist", "Anomalia da atmosfera da cabine (CO2 / O2) — checklist de demonstração"), _steps(
        ("Confirm readings with the portable CO2 / O2 monitor.", "Confirmar as leituras com o monitor portátil de CO2 / O2."),
        ("Inform the whole crew; follow the habitat's trained atmosphere procedure.", "Informar toda a tripulação; seguir o procedimento de atmosfera treinado."),
        ("Inspect the CO2 scrubber and replace the cartridge if indicated.", "Inspecionar o filtro de CO2 e trocar o cartucho se indicado."),
        ("Check every crew member for symptoms and take vital signs.", "Verificar sintomas em cada tripulante e medir sinais vitais."),
        ("Ask the crew medical officer to assess affected crew members.", "Pedir ao oficial médico para avaliar os tripulantes afetados."),
        ("Log readings and actions; report to ground when the link allows.", "Registrar leituras e ações; reportar ao solo quando o link permitir."),
    )),
    ("PROT-GENERAL", "general", L("General abnormal indicators — demo checklist", "Indicadores anormais gerais — checklist de demonstração"), _steps(
        ("Repeat the measurements and check sensors.", "Repetir as medições e verificar os sensores."),
        ("Ask the crew member about symptoms and record them.", "Perguntar ao tripulante sobre sintomas e registrá-los."),
        ("Call the crew medical officer for assessment.", "Chamar o oficial médico para avaliação."),
        ("Log actions and notify ground when the link allows.", "Registrar ações e notificar o solo quando o link permitir."),
    )),
]


def data_sources() -> list[DataSource]:
    osdr_list = ", ".join(OSDR_STUDIES)
    return [
        DataSource(key="nasa_donki", category="nasa_open_data", provider="NASA / CCMC (Community Coordinated Modeling Center)",
                   name="DONKI — Space Weather Database Of Notifications, Knowledge, Information",
                   url="https://api.nasa.gov/", endpoint=f"{DONKI_PRIMARY} (FLR, SEP, CME, GST) · fallback {DONKI_FALLBACK}",
                   description=L("Space weather event records: solar flares (FLR), solar energetic particle events (SEP), coronal mass ejections (CME) and geomagnetic storms (GST).",
                                 "Registros de eventos de clima espacial: erupções solares (FLR), partículas solares energéticas (SEP), ejeções de massa coronal (CME) e tempestades geomagnéticas (GST)."),
                   measures=L("Event times, flare X-ray class, CME notes and geomagnetic Kp index.", "Horários dos eventos, classe de raios X das erupções, notas de CME e índice Kp."),
                   limitations=L("Describes the heliospheric environment, not any astronaut's radiation dose. DEMO_KEY is rate limited; offline mode uses cached or synthetic sample records (clearly labeled).",
                                 "Descreve o ambiente heliosférico, não a dose de radiação de astronautas. A DEMO_KEY tem limite de uso; o modo offline usa cache ou amostras sintéticas (rotuladas)."),
                   usage=L("Space Environment page and contextual factor in Early Warning (0 points; never treated as dose).",
                           "Página Space Environment e fator contextual no Early Warning (0 pontos; nunca tratado como dose).")),
        DataSource(key="nasa_osdr", category="nasa_open_data", provider="NASA Open Science Data Repository (OSDR)",
                   name=f"OSDR human spaceflight study metadata ({osdr_list})", url="https://osdr.nasa.gov/",
                   endpoint=OSDR_META.format(num="{id}"),
                   description=L("Metadata (title, description, assays, factors, release date) of human spaceflight studies, e.g. the SpaceX Inspiration4 whole-blood dataset (OSD-569) and astronaut gene-expression study (OSD-53).",
                                 "Metadados (título, descrição, ensaios, fatores, data) de estudos de voo espacial humano, ex.: sangue total da Inspiration4 (OSD-569) e expressão gênica de astronautas (OSD-53)."),
                   measures=L("The studies measure omics and blood parameters (e.g. RNA-seq, complete blood count) before, during and after flight.",
                              "Os estudos medem ômicas e parâmetros sanguíneos (ex.: RNA-seq, hemograma) antes, durante e após o voo."),
                   limitations=L("ORBITA shows these studies as scientific context only. No ORBITA measurement, baseline or threshold is derived from them.",
                                 "O ORBITA mostra esses estudos apenas como contexto científico. Nenhuma medição, linha de base ou limite do ORBITA é derivado deles."),
                   usage=L("Bio-Twin 'Spaceflight research context' panel and Data Sources page.", "Painel 'Contexto de pesquisa' do Bio-Twin e página de fontes.")),
        DataSource(key="simulated_physiology", category="simulated", provider="ORBITA simulator", name="Simulated physiological and cabin readings",
                   url="", endpoint="/api/astronauts/{id}/simulate · /api/scenarios/{key}/run",
                   description=L("Synthetic vitals, daily logs and cabin readings for a fictional crew, plus three emergency scenarios.",
                                 "Sinais vitais, registros diários e leituras de cabine sintéticos para uma tripulação fictícia, mais três cenários de emergência."),
                   measures=L("Heart rate, SpO2, blood pressure, temperature, respiratory rate, sleep, activity, hydration, cognitive score, cabin atmosphere, simulated dose rate.",
                              "FC, SpO2, pressão, temperatura, FR, sono, atividade, hidratação, cognição, atmosfera da cabine, taxa de dose simulada."),
                   limitations=L("Not real astronaut data. Generated from fictional profiles with random noise.", "Não são dados reais de astronautas. Gerados a partir de perfis fictícios com ruído aleatório."),
                   usage=L("All health monitoring screens (labeled SIMULATED).", "Todas as telas de monitoramento (rotuladas SIMULADO)."), status="active"),
        DataSource(key="user_entered", category="user_entered", provider="ORBITA user", name="User-entered demonstration data",
                   url="", endpoint="/api/astronauts/{id}/measurements · /api/astronauts/{id}/daily",
                   description=L("Measurements typed manually in Vital-Scan or Bio-Twin.", "Medições digitadas manualmente no Vital-Scan ou Bio-Twin."),
                   measures=L("Any of the monitored indicators.", "Qualquer indicador monitorado."),
                   limitations=L("Demonstration input; validated only for plausible physical ranges.", "Entrada de demonstração; validada apenas para faixas fisicamente plausíveis."),
                   usage=L("Labeled USER-ENTERED everywhere.", "Rotulado como INSERIDO PELO USUÁRIO."), status="active"),
    ]


def seed(db: Session, force: bool = False) -> bool:
    if not force and db.scalar(select(Mission.id).limit(1)):
        return False
    if force:
        Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    now = utcnow().replace(second=0, microsecond=0)
    rng = np.random.default_rng(2026)
    db.add(Mission(name="ORBITA-1 Demonstration Mission", habitat="Long-duration habitat (simulated)",
                   description=L("Fictional long-duration mission used to demonstrate ORBITA. Not a real mission.",
                                 "Missão fictícia de longa duração usada para demonstrar o ORBITA. Não é uma missão real."),
                   start_at=now - timedelta(days=117, hours=6), planned_duration_days=180, is_simulated=True))
    history_start = now - timedelta(days=14)
    for c in CREW:
        a = Astronaut(**c, notes="Fictional crew member for demonstration.", is_fictional=True)
        db.add(a)
        db.flush()
        gaps = {"temperature": (now - timedelta(hours=9), now + timedelta(days=1))} if c["code"] == "AST-04" else None
        generate_history(db, a, history_start, now, rng, gaps)
        db.flush()
        compute_baselines(db, a, now)
        states = {m: "connected" for m in VITALS}
        if gaps:
            states["temperature"] = "disconnected"
        put_setting(db, f"sensors:{a.id}", states)
    generate_env_history(db, history_start, now, rng)
    for name, cat, tags, qty, unit, loc in RESOURCES:
        db.add(MedicalResource(name=name, category=cat, tags=tags, quantity=qty, unit=unit, location=loc, status="available"))
    for key, cat, title, steps in PROTOCOLS:
        db.add(EmergencyProtocol(key=key, category=cat, title=title, steps=steps))
    for s in data_sources():
        db.add(s)
    put_setting(db, "link", {"status": "nominal", "one_way_delay_s": 20})
    log_event(db, "system", L("ORBITA initialized with a fictional crew and simulated history.",
                              "ORBITA inicializado com tripulação fictícia e histórico simulado."), "info", None, now)
    log_event(db, "sensor", L("Temperature sensor of Lucas Ferreira disconnected (simulated).",
                              "Sensor de temperatura de Lucas Ferreira desconectado (simulado)."), "warn",
              db.scalar(select(Astronaut.id).where(Astronaut.code == "AST-04")), now - timedelta(hours=9))
    db.commit()
    return True


EDUCATIONAL_NOTICE = EDU
