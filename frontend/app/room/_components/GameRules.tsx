export function GameRules() {
  return (
    <div className="rules">
      <strong>Règles du Gauntlet</strong>
      <ul>
        <li>
          Vous devez réussir l&apos;objectif des <strong>10 jeux dans l&apos;ordre</strong> sans une seule défaite.
        </li>
        <li>
          Si l&apos;objectif d&apos;un jeu n&apos;est pas atteint, deux pénalités au choix dans la config :{" "}
          <strong>Reset complet</strong> (retour jeu 1) ou <strong>Recule d&apos;un jeu</strong>.
        </li>
        <li>
          Les jeux marqués <span style={{ color: "var(--gold)", fontWeight: 700 }}>SOLO</span> doivent être réussis par <strong>un seul joueur tiré au sort</strong>.
        </li>
        <li>
          Les jeux marqués <span style={{ color: "var(--accent-2)", fontWeight: 700 }}>DUO</span> sont joués en duo tiré au sort. Avec 4+ joueurs, le tirage forme plusieurs duos coopératifs en parallèle (chaque duo joue le même objectif de son côté).
        </li>
        <li>
          Mode <strong>Hardcore</strong> : objectifs nettement plus exigeants.
        </li>
        <li>Bouton Swap par carte : remplace un seul jeu par un autre tiré au sort dans le pool restant.</li>
        <li>La progression et l&apos;historique sont sauvegardés automatiquement dans ce navigateur.</li>
      </ul>
    </div>
  );
}
