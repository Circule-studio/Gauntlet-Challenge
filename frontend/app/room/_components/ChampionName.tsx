// Renders a formatted champion string with each name preceded by its avatar.
// Falls back to plain text when no avatar map is provided (history view, etc.).
// Splits on the pair separators (" & " inside a duo, " · " between duos) and
// keeps them as literal tokens, so structure is preserved without parsing it.
export function ChampionName({
  text,
  nameToAvatar,
}: {
  text: string;
  nameToAvatar?: Record<string, string>;
}) {
  if (!nameToAvatar) return <span className="name">{text}</span>;
  const tokens = text.split(/( & | · )/);
  return (
    <span className="name champion-name-with-avatars">
      {tokens.map((tok, i) => {
        if (tok === " & " || tok === " · ") return <span key={i} className="champion-sep">{tok}</span>;
        const av = nameToAvatar[tok];
        return (
          <span key={i} className="champion-pick">
            {av && <img className="champion-avatar" src={av} alt="" />}
            <span className="champion-pick-name">{tok}</span>
          </span>
        );
      })}
    </span>
  );
}
