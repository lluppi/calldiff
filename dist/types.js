/** Copy optional location / kind fields onto a tree node without empty spreads. */
export function assignOptionalTreeFields(target, source) {
    if (source.kind)
        target.kind = source.kind;
    if (source.file)
        target.file = source.file;
    if (source.line != null)
        target.line = source.line;
    if (source.endLine != null)
        target.endLine = source.endLine;
    return target;
}
