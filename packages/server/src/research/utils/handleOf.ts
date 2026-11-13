export const handleOf = (value: string) =>
  value.match(/(?:handle\/|handle.net\/|econstor\.eu:)(10419\/\d+)/)?.[1]
