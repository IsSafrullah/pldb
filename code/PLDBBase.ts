import { jtree } from "jtree"
import {
  nodeToFlatObject,
  getJoined,
  isLanguage,
  getCleanedId,
  makeInverseRanks,
  Ranking,
  Rankings,
  InverseRankings,
  rankSort,
  imemo
} from "./utils"

const path = require("path")
const lodash = require("lodash")
const { Table } = require("jtree/products/jtable.node.js")
const { TreeNode } = jtree
const {
  TreeBaseFolder,
  TreeBaseFile
} = require("jtree/products/treeBase.node.js")
const { Disk } = require("jtree/products/Disk.node.js")

interface FeatureSummary {
  feature: string
  featureLink: string
  aka: string
  path: string
  token?: string
  yes: number
  no: number
  percentage: string
  pseudoExample: string
}

interface FeaturePrediction {
  value: boolean
  token?: string
  example?: string
}

interface Example {
  code: string
  source: string
  link: string
}

const databaseFolder = path.join(__dirname, "..", "database")

// Todo: move to Grammar with an enum concept?
const typeNames = new TreeNode(`application
assembly assembly language
binaryDataFormat
binaryExecutable binary executable format
bytecode bytecode format
characterEncoding
cloud cloud service
compiler
editor
esolang esoteric programming language
filesystem
framework
grammarLanguage
idl interface design language
interpreter
ir intermediate representation language
isa instruction set architecture
jsonFormat
library
linter
metalanguage
notation
os operating system
packageManager
feature language feature
pl programming language
plzoo minilanguage
protocol
queryLanguage
schema
standard
stylesheetLanguage
template template language
textData text data format
textMarkup text markup language
visual visual programming language
vm virtual machine
webApi
xmlFormat`).toObject()

const runtimeCsvProps = {}
const includeInCsv = <Type>(
  target: unknown,
  propertyName: string,
  descriptor: TypedPropertyDescriptor<Type>
): void => {
  runtimeCsvProps[propertyName] = ""
}

class PLDBFile extends TreeBaseFile {
  @includeInCsv
  get pldbId() {
    return this.id
  }

  get missingColumns() {
    return this.base.columnDocumentation
      .filter(col => col.Description !== "computed")
      .filter(col => !col.Column.includes("."))
      .filter(col => !this.has(col.Column))
  }

  get missingRecommendedColumns() {
    return this.missingColumns.filter(col => col.Recommended === true)
  }

  // todo:refactor columnDocumentation
  // @includeInCsv
  // get missingColumnsCount() {
  //   return this.missingColumns.length
  // }

  get domainName() {
    return this.get("domainName")
  }

  get permalink() {
    return this.id + ".html"
  }

  get link() {
    return `<a href="${this.permalink}">${this.title}</a>`
  }

  get subredditId() {
    return this.get("subreddit")?.replace("https://reddit.com/r/", "")
  }

  @includeInCsv
  get bookCount() {
    const gr = this.getNode(`goodreads`)?.length
    const isbndb = this.getNode(`isbndb`)?.length
    let count = 0
    if (gr) count += gr - 1
    if (isbndb) count += isbndb - 1
    return count
  }

  @includeInCsv
  get paperCount() {
    const ss = this.getNode(`semanticScholar`)?.length

    let count = 0
    if (ss) count += ss - 1
    return count
  }

  get filename() {
    return this.id + ".pldb"
  }

  get names() {
    return [
      this.id,
      this.title,
      this.get("standsFor"),
      this.get("githubLanguage"),
      this.wikipediaTitle,
      ...this.getAll("aka")
    ].filter(i => i)
  }

  get fileExtension() {
    return this.extensions.split(" ")[0]
  }

  get keywords() {
    const kw = this.get("keywords")
    return kw ? kw.split(" ") : []
  }

  get featurePath() {
    return `features ${this.get("featureKeyword")}`
  }

  get previousRankedFeature() {
    return this.base.getFeatureAtRank(this.base.getFeatureRank(this) - 1)
  }

  get nextRankedFeature() {
    return this.base.getFeatureAtRank(this.base.getFeatureRank(this) + 1)
  }

  get lineCommentToken() {
    return this.get("lineCommentToken")
  }

  get langRankDebug() {
    const obj = this.base.getLanguageRankExplanation(this)
    return `TotalRank: ${obj.totalRank} Jobs: ${obj.jobsRank} Users: ${obj.usersRank} Facts: ${obj.factsRank} Links: ${obj.inboundLinksRank}`
  }

  get previousRanked() {
    return this.isLanguage
      ? this.base.getFileAtLanguageRank(this.languageRank - 1)
      : this.base.getFileAtRank(this.rank - 1)
  }

  get nextRanked() {
    return this.isLanguage
      ? this.base.getFileAtLanguageRank(this.languageRank + 1)
      : this.base.getFileAtRank(this.rank + 1)
  }

  @includeInCsv
  get exampleCount() {
    return this.allExamples.length + this.featuresWithExamples.length
  }

  get featuresWithExamples() {
    const featuresTable = this.getNode(`features`)
    if (!featuresTable) return []
    return featuresTable.filter(node => node.length)
  }

  get corporateDevelopers(): string[] {
    return this.getAll("corporateDevelopers")
  }

  get creators(): string[] {
    return this.get("creators")?.split(" and ") ?? []
  }

  get hasBooleansPrediction(): FeaturePrediction {
    const { keywords } = this

    const pairs = ["true false", "TRUE FALSE", "True False"]

    let hit
    pairs.forEach(pair => {
      const parts = pair.split(" ")
      if (keywords.includes(parts[0]) && keywords.includes(parts[1]))
        hit = {
          value: true,
          token: pair
        }
    })

    if (hit) return hit

    const examples = this.allExamples.map(code => code.code)
    pairs.forEach(pair => {
      const parts = pair.split(" ")

      const hasTrue = examples.some(code => code.includes(parts[0]))
      const hasFalse = examples.some(code => code.includes(parts[1]))

      if (hasTrue && hasFalse)
        hit = {
          value: true,
          token: pair
        }
    })

    return hit
  }

  get hasImportsPrediction(): FeaturePrediction {
    const { keywords } = this

    const words = ["import", "include", "require"]

    for (let word of words) {
      if (keywords.includes(word)) {
        const example = this.allExamples.find(code => code.code.includes(word))

        if (example) {
          const exampleLine = example.code
            .split("\n")
            .filter(line => line.includes(word))[0]
          return {
            value: true,
            token: word,
            example: exampleLine
          }
        } else {
          console.log(`No example found for ${this.id}`)
        }
      }
    }
  }

  makeSimpleKeywordPrediction(theWord: string): FeaturePrediction {
    const { keywords } = this

    if (keywords.includes(theWord))
      return {
        value: true
      }
  }

  get hasWhileLoopsPrediction() {
    return this.makeSimpleKeywordPrediction("while")
  }

  get hasClassesPrediction() {
    return this.makeSimpleKeywordPrediction("class")
  }

  get hasConstantsPrediction() {
    return this.makeSimpleKeywordPrediction("const")
  }

  get hasExceptionsPrediction() {
    return this.makeSimpleKeywordPrediction("throw")
  }

  get hasSwitchPrediction() {
    return this.makeSimpleKeywordPrediction("switch")
  }

  get hasAccessModifiersPrediction() {
    return this.makeSimpleKeywordPrediction("public")
  }

  get hasInheritancePrediction() {
    return this.makeSimpleKeywordPrediction("extends")
  }

  get hasAsyncAwaitPrediction() {
    return this.makeSimpleKeywordPrediction("async")
  }

  get hasConditionalsPrediction() {
    return this.makeSimpleKeywordPrediction("if")
  }

  get hasFunctionsPrediction() {
    return (
      this.makeSimpleKeywordPrediction("function") ||
      this.makeSimpleKeywordPrediction("fun") ||
      this.makeSimpleKeywordPrediction("def")
    )
  }

  get allExamples(): Example[] {
    const examples: Example[] = []

    this.findNodes("example").forEach(node => {
      examples.push({
        code: node.childrenToString(),
        source: "the web",
        link: ""
      })
    })

    this.findNodes("compilerExplorer example").forEach(node => {
      examples.push({
        code: node.childrenToString(),
        source: "Compiler Explorer",
        link: `https://godbolt.org/`
      })
    })

    this.findNodes("rijuRepl example").forEach(node => {
      examples.push({
        code: node.childrenToString(),
        source: "Riju",
        link: this.get("rijuRepl")
      })
    })

    this.findNodes("leachim6").forEach(node => {
      examples.push({
        code: node.getNode("example").childrenToString(),
        source: "hello-world",
        link:
          `https://github.com/leachim6/hello-world/blob/main/` +
          node.get("filepath")
      })
    })

    this.findNodes("helloWorldCollection").forEach(node => {
      examples.push({
        code: node.childrenToString(),
        source: "the Hello World Collection",
        link: `http://helloworldcollection.de/#` + node.getWord(1)
      })
    })

    const linguist_url = this.get("linguistGrammarRepo")
    this.findNodes("linguistGrammarRepo example").forEach(node => {
      examples.push({
        code: node.childrenToString(),
        source: "Linguist",
        link: linguist_url
      })
    })

    this.findNodes("wikipedia example").forEach(node => {
      examples.push({
        code: node.childrenToString(),
        source: "Wikipedia",
        link: this.get("wikipedia")
      })
    })

    return examples
  }

  @imemo
  get _getLanguagesWithThisFeatureResearched() {
    const featureKeyword = this.get("featureKeyword")

    return this.base.topLanguages.filter(file =>
      file.getNode("features")?.has(featureKeyword)
    )
  }

  get languagesWithThisFeature() {
    const { featurePath } = this
    return this._getLanguagesWithThisFeatureResearched.filter(
      file => file.get(featurePath) === "true"
    )
  }

  get languagesWithoutThisFeature() {
    const { featurePath } = this
    return this._getLanguagesWithThisFeatureResearched.filter(
      file => file.get(featurePath) === "false"
    )
  }

  getMostRecentInt(pathToSet: string): number {
    let set = this.getNode(pathToSet)
    if (!set) return 0
    set = set.toObject()
    const key = Math.max(...Object.keys(set).map(year => parseInt(year)))
    return parseInt(set[key])
  }

  @imemo
  get title(): string {
    return this.get("title") || this.id
  }

  @imemo
  get appeared(): number {
    const appeared = this.get("appeared")
    return appeared === undefined ? 0 : parseInt(appeared)
  }

  @imemo
  get website(): string {
    return this.get("website")
  }

  @imemo
  get type(): string {
    return this.get("type")
  }

  get isLanguage() {
    return isLanguage(this.get("type"))
  }

  get otherReferences() {
    return this.findNodes("reference").map(line => line.getContent())
  }

  get isFeature() {
    return this.get("type") === "feature"
  }

  get wikipediaTitle() {
    const wp = this.get("wikipedia")
    return wp ? wp.replace("https://en.wikipedia.org/wiki/", "").trim() : ""
  }

  @includeInCsv
  get numberOfUsers() {
    return this.base.predictNumberOfUsers(this)
  }

  @includeInCsv
  get numberOfRepos() {
    return this.get("githubLanguage repos")
  }

  @includeInCsv
  get numberOfJobs() {
    return this.base.predictNumberOfJobs(this)
  }

  get percentile() {
    return this.base.predictPercentile(this)
  }

  get supersetFile(): PLDBFile | undefined {
    const supersetOf = this.get("supersetOf")
    return supersetOf ? this.base.getFile(supersetOf) : undefined
  }

  @includeInCsv
  get languageRank() {
    return this.isLanguage ? this.base.getLanguageRank(this) : undefined
  }

  @includeInCsv
  get rank() {
    return this.base.getRank(this)
  }

  get extensions() {
    return getJoined(this, [
      "fileExtensions",
      "githubLanguage fileExtensions",
      "pygmentsHighlighter fileExtensions",
      "wikipedia fileExtensions"
    ])
  }

  @imemo
  get typeName() {
    let { type } = this
    type = typeNames[type] || type
    return lodash.startCase(type).toLowerCase()
  }

  get base() {
    return this.getParent() as PLDBBaseFolder
  }

  @imemo
  get parsed() {
    return super.parsed
  }

  @includeInCsv
  @imemo
  get factCount() {
    return this.parsed.filter(node => node.shouldSerialize !== false).length
  }

  @imemo
  get linksToOtherFiles() {
    return lodash.uniq(
      this.parsed
        .getTopDownArray()
        .filter(node => node.providesPermalinks)
        .map(node => node.getWords().slice(1))
        .flat()
    )
  }

  @includeInCsv
  get lastActivity(): number {
    return lodash.max(
      this.parsed
        .findAllWordsWithCellType("yearCell")
        .map(word => parseInt(word.word))
    )
  }

  getAll(keyword) {
    return this.findNodes(keyword).map(i => i.getContent())
  }

  // todo: move upstream to TreeBase or Grammar
  prettify() {
    const str = this.base.prettifyContent(this.childrenToString())
    this.setChildren(str)
  }

  prettifyAndSave() {
    this.prettify()
    this.save()
    return this
  }
}

class PLDBBaseFolder extends TreeBaseFolder {
  static getBase(): PLDBBaseFolder {
    return new PLDBBaseFolder()
      .setDir(path.join(databaseFolder, "things"))
      .setGrammarDir(path.join(databaseFolder, "grammar"))
  }

  createParser() {
    return new TreeNode.Parser(PLDBFile)
  }

  get featureFiles(): PLDBFile[] {
    return this.filter(file => file.get("type") === "feature")
  }

  @imemo
  get inboundLinks(): { [id: string]: string[] } {
    const inBoundLinks = {}
    this.forEach(file => {
      inBoundLinks[file.id] = []
    })

    this.forEach(file => {
      file.linksToOtherFiles.forEach(link => {
        if (!inBoundLinks[link])
          console.error(
            `Broken permalink in '${file.id}': No language "${link}" found`
          )
        else inBoundLinks[link].push(file.id)
      })
    })

    return inBoundLinks
  }

  get grammarDef() {
    const gpc = this.grammarProgramConstructor
    return new gpc().getDefinition()
  }

  @imemo
  get searchIndex(): Map<string, string> {
    const map = new Map()
    this.forEach(file => {
      const { id } = file
      file.names.forEach(name => map.set(name.toLowerCase(), id))
    })
    return map
  }

  searchForEntity(query: string) {
    if (query === undefined || query === "") return
    const { searchIndex } = this
    return (
      searchIndex.get(query) ||
      searchIndex.get(query.toLowerCase()) ||
      searchIndex.get(getCleanedId(query))
    )
  }

  searchForEntityByFileExtensions(extensions: string[] = []) {
    const { extensionsMap } = this
    const hit = extensions.find(ext => extensionsMap.has(ext))
    return extensionsMap.get(hit)
  }

  @imemo
  get extensionsMap() {
    const extensionsMap = new Map<string, string>()
    this.topLanguages
      .slice(0)
      .reverse()
      .forEach(file => {
        file.extensions
          .split(" ")
          .forEach(ext => extensionsMap.set(ext, file.id))
      })

    return extensionsMap
  }

  getFile(id: string): PLDBFile | undefined {
    if (id === undefined) return undefined
    if (id.includes("/")) id = Disk.getFileName(id).replace(".pldb", "")
    return this.getNode(id)
  }

  @imemo
  get topLanguages(): PLDBFile[] {
    return lodash.sortBy(
      this.filter(lang => lang.isLanguage),
      "languageRank"
    )
  }

  predictNumberOfUsers(file: PLDBFile) {
    const mostRecents = [
      "linkedInSkill",
      "subreddit memberCount",
      "projectEuler members"
    ]
    const directs = ["meetup members", "githubRepo stars"]
    const customs = {
      wikipedia: v => 20,
      packageRepository: v => 1000, // todo: pull author number
      "wikipedia dailyPageViews": count => 100 * (parseInt(count) / 20), // say its 95% bot traffic, and 1% of users visit the wp page daily
      linguistGrammarRepo: c => 200, // According to https://github.com/github/linguist/blob/master/CONTRIBUTING.md, linguist indicates a min of 200 users.
      codeMirror: v => 50,
      website: v => 1,
      githubRepo: v => 1,
      "githubRepo forks": v => v * 3
    }

    return Math.round(
      lodash.sum(mostRecents.map(key => file.getMostRecentInt(key))) +
        lodash.sum(directs.map(key => parseInt(file.get(key) || 0))) +
        lodash.sum(
          Object.keys(customs).map(key => {
            const val = file.get(key)
            return val ? customs[key](val) : 0
          })
        )
    )
  }

  predictNumberOfJobs(file: PLDBFile) {
    return (
      Math.round(file.getMostRecentInt("linkedInSkill") * 0.01) +
      file.getMostRecentInt("indeedJobs")
    )
  }

  private calcRanks(files: PLDBFile[] = this.getChildren()) {
    const { inboundLinks } = this
    let objects = files.map(file => {
      const id = file.id
      const object: any = {}
      object.id = id
      object.jobs = this.predictNumberOfJobs(file)
      object.users = this.predictNumberOfUsers(file)
      object.facts = file.factCount
      object.inboundLinks = inboundLinks[id].length
      return object
    })

    objects = rankSort(objects, "jobs")
    objects = rankSort(objects, "users")
    objects = rankSort(objects, "facts")
    objects = rankSort(objects, "inboundLinks")

    objects.forEach((obj, rank) => {
      // Drop the item this does the worst on, as it may be a flaw in PLDB.
      const top3: number[] = [
        obj.jobsRank,
        obj.usersRank,
        obj.factsRank,
        obj.inboundLinksRank
      ]
      obj.totalRank = lodash.sum(lodash.sortBy(top3).slice(0, 3))
    })
    objects = lodash.sortBy(objects, ["totalRank"])

    const ranks: Rankings = {}
    objects.forEach((obj, index) => {
      obj.index = index
      ranks[obj.id] = obj as Ranking
    })
    return ranks
  }

  @imemo
  get rankings() {
    const files = this.getChildren()
    const ranks = this.calcRanks(files)
    const inverseRanks = makeInverseRanks(ranks)
    const languageRanks = this.calcRanks(files.filter(file => file.isLanguage))
    const inverseLanguageRanks = makeInverseRanks(languageRanks)
    const featureRanks = this.calcRanks(files.filter(file => file.isFeature))
    const inverseFeatureRanks = makeInverseRanks(featureRanks)

    return {
      ranks,
      inverseRanks,
      languageRanks,
      inverseLanguageRanks,
      featureRanks,
      inverseFeatureRanks
    }
  }

  private _getFileAtRank(rank: number, ranks: InverseRankings) {
    const count = Object.keys(ranks).length
    if (rank < 0) rank = count - 1
    if (rank >= count) rank = 0
    return this.getFile(ranks[rank].id)
  }

  @imemo
  get featuresMap(): Map<string, FeatureSummary> {
    const featuresMap = new Map<string, FeatureSummary>()
    this.topFeatures.forEach(feature => {
      featuresMap.set(feature.path, feature)
    })
    return featuresMap
  }

  @imemo
  get topFeatures(): FeatureSummary[] {
    const files = this.featureFiles.map(file => {
      const name = file.id
      const positives = file.languagesWithThisFeature.length
      const negatives = file.languagesWithoutThisFeature.length
      const measurements = positives + negatives
      return {
        feature: file.get("title"),
        featureLink: `../languages/${file.permalink}`,
        aka: file.getAll("aka").join(" or "),
        path: file.get("featureKeyword"),
        token: file.get("tokenKeyword"),
        yes: positives,
        no: negatives,
        percentage:
          measurements < 100
            ? "-"
            : lodash.round((100 * positives) / measurements, 0) + "%",
        pseudoExample: (file.get("pseudoExample") || "")
          .replace(/\</g, "&lt;")
          .replace(/\|/g, "&#124;")
      }
    })

    const sorted = lodash.sortBy(files, "yes")
    sorted.reverse()

    return sorted
  }

  getFeatureAtRank(rank: number) {
    return this._getFileAtRank(rank, this.rankings.inverseFeatureRanks)
  }

  getFileAtLanguageRank(rank: number) {
    return this._getFileAtRank(rank, this.rankings.inverseLanguageRanks)
  }

  getFileAtRank(rank: number) {
    return this._getFileAtRank(rank, this.rankings.inverseRanks)
  }

  predictPercentile(file: PLDBFile) {
    const files = this.getChildren()
    const { ranks } = this.rankings
    return ranks[file.id].index / files.length
  }

  getLanguageRankExplanation(file: PLDBFile) {
    return this.rankings.languageRanks[file.id]
  }

  getFeatureRank(file: PLDBFile) {
    return this.rankings.featureRanks[file.id].index
  }

  getLanguageRank(file: PLDBFile) {
    return this.rankings.languageRanks[file.id].index
  }

  getRank(file: PLDBFile) {
    return this.rankings.ranks[file.id].index
  }

  makeId(title: string) {
    let id = getCleanedId(title)
    let newId = id
    if (!this.getFile(newId)) return newId

    newId = id + "-lang"
    if (!this.getFile(newId)) return newId

    throw new Error(
      `Already language with id: "${id}". Are you sure this is a new language? Perhaps update the title to something more unique, then update title back`
    )
  }

  createFile(content: string, id?: string) {
    if (id === undefined) {
      const title = new TreeNode(content).get("title")
      if (!title)
        throw new Error(`A "title" must be provided when creating a new file`)

      id = this.makeId(title)
    }
    Disk.write(this.makeFilePath(id), content)
    return this.appendLineAndChildren(id, content)
  }

  get exampleCounts() {
    const counts = new Map<string, number>()
    this.forEach(file => counts.set(file.id, file.exampleCount))
    return counts
  }

  @imemo
  get colNameToGrammarDefMap() {
    const map = new Map()
    this.nodesForCsv.forEach(node => {
      node.getTopDownArray().forEach(node => {
        const path = node.getFirstWordPath().replace(/ /g, ".")
        map.set(path, node.getDefinition())
      })
    })
    return map
  }

  get colNamesForCsv() {
    return this.columnDocumentation.map(col => col.Column)
  }

  // todo: is there already a way to do this in jtree?
  getFilePathAndLineNumberWhereGrammarNodeIsDefined(nodeTypeId: string) {
    const { grammarFileMap } = this
    const regex = new RegExp(`^${nodeTypeId}`, "gm")
    let filePath
    let lineNumber
    Object.keys(grammarFileMap).some(grammarFilePath => {
      const code = grammarFileMap[grammarFilePath]
      if (grammarFileMap[grammarFilePath].match(regex)) {
        filePath = grammarFilePath
        lineNumber = code.split("\n").indexOf(nodeTypeId)
        return true
      }
    })
    return { filePath, lineNumber }
  }

  @imemo
  get grammarFileMap() {
    const map = {}
    this.grammarFilePaths.forEach(filepath => {
      map[filepath] = Disk.read(filepath)
    })
    return map
  }

  @imemo
  get columnDocumentation() {
    // Return columns with documentation sorted in the most interesting order.

    const { colNameToGrammarDefMap, objectsForCsv } = this
    const colNames = new TreeNode(objectsForCsv)
      .toCsv()
      .split("\n")[0]
      .split(",")
      .map(col => {
        return { name: col }
      })
    const table = new Table(objectsForCsv, colNames, undefined, false) // todo: fix jtable or switch off
    const cols = table
      .getColumnsArray()
      .map(col => {
        const reductions = col.getReductions()
        const Column = col.getColumnName()
        const colDef = colNameToGrammarDefMap.get(Column)
        const colDefId = colDef.getLine()
        const Example = reductions.mode
        const Description =
          colDefId !== "errorNode" ? colDef.get("description") : "computed"
        const Source = colDef.getFrom("string sourceDomain")
        const sourceLocation = this.getFilePathAndLineNumberWhereGrammarNodeIsDefined(
          colDefId
        )
        const Definition =
          colDefId !== "errorNode"
            ? path.basename(sourceLocation.filePath)
            : "A computed value"
        const DefinitionLink =
          colDefId !== "errorNode"
            ? `https://github.com/breck7/pldb/blob/main/database/grammar/${Definition}#L${sourceLocation.lineNumber +
                1}`
            : ""
        const SourceLink = Source ? `https://${Source}` : ""
        return {
          Column,
          Values: reductions.count,
          Coverage:
            Math.round(
              (100 * reductions.count) /
                (reductions.count + reductions.incompleteCount)
            ) + "%",
          Example,
          Source,
          SourceLink,
          Description,
          Definition,
          DefinitionLink,
          Recommended:
            colDef && colDef.getFrom("boolean alwaysRecommended") === "true"
        }
      })
      .filter(col => col.Values)

    const sortTemplate = `title
appeared
type
pldbId
rank
languageRank
factCount
lastActivity
exampleCount
bookCount
paperCount
numberOfUsers
numberOfJobs
githubBigQuery.repos
creators
githubRepo
website
wikipedia`.split("\n")

    const sortedCols = []
    sortTemplate.forEach(colName => {
      const hit = cols.find(col => col.Column === colName)
      sortedCols.push(hit)
    })

    lodash
      .sortBy(cols, "Values")
      .reverse()
      .forEach(col => {
        if (!sortTemplate.includes(col.Column)) sortedCols.push(col)
      })

    sortedCols.forEach((col, index) => {
      col.Index = index + 1
    })

    return sortedCols
  }

  @imemo
  get nodesForCsv() {
    const runTimeProps = Object.keys(runtimeCsvProps)
    return this.map(file => {
      const clone = file.parsed.clone()
      clone.getTopDownArray().forEach(node => {
        if (node.includeChildrenInCsv === false) node.deleteChildren()
        if (node.getNodeTypeId() === "blankLineNode") node.destroy()
      })

      runTimeProps.forEach(prop => {
        const value = file[prop]
        if (value !== undefined) clone.set(prop, value.toString())
      })

      return clone
    })
  }

  @imemo
  get objectsForCsv() {
    return lodash.sortBy(this.nodesForCsv.map(nodeToFlatObject), item =>
      parseInt(item.rank)
    )
  }

  @imemo
  get csvBuildOutput() {
    const { colNamesForCsv, objectsForCsv, columnDocumentation } = this

    const pldbCsv = new TreeNode(objectsForCsv).toDelimited(",", colNamesForCsv)

    const langsCsv = new TreeNode(
      objectsForCsv.filter(obj => isLanguage(obj.type))
    ).toDelimited(",", colNamesForCsv)

    const columnsMetadataTree = new TreeNode(columnDocumentation)
    const columnMetadataColumnNames = [
      "Index",
      "Column",
      "Values",
      "Coverage",
      "Example",
      "Description",
      "Source",
      "SourceLink",
      "Definition",
      "DefinitionLink"
    ]

    const columnsCsv = columnsMetadataTree.toDelimited(
      ",",
      columnMetadataColumnNames
    )

    return {
      pldbCsv,
      langsCsv,
      columnsCsv,
      columnsMetadataTree,
      columnMetadataColumnNames,
      colNamesForCsv
    }
  }

  get sortTemplate() {
    return Disk.read(path.join(databaseFolder, "sortTemplate.txt")).replace(
      /\n\n/,
      "\n"
    )
  }

  @imemo
  get sortIndices() {
    const sortIndices = new Map()
    this.sortTemplate.split("\n").forEach((word, index) => {
      sortIndices.set(word, index)
    })
    return sortIndices
  }

  @imemo
  get sortSections() {
    const sections = new Map()
    this.sortTemplate.split("#").forEach((section, sectionIndex) => {
      section.split("\n").forEach(word => {
        sections.set(word, sectionIndex)
      })
    })
    return sections
  }

  get sources() {
    const sources = Array.from(
      new Set(
        this.grammarCode
          .split("\n")
          .filter(line => line.includes("string sourceDomain"))
          .map(line => line.split("string sourceDomain")[1].trim())
      )
    )
    return sources.sort()
  }

  @imemo
  get keywordsOneHot() {
    const { keywordsTable } = this
    const allKeywords = keywordsTable.rows.map(row => row.keyword)
    const langsWithKeywords = this.topLanguages.filter(file =>
      file.has("keywords")
    )
    const headerRow = allKeywords.slice()
    headerRow.unshift("pldbId")
    const rows = langsWithKeywords.map(file => {
      const row = [file.id]
      const keywords = new Set(file.keywords)
      allKeywords.forEach(keyword => {
        row.push(keywords.has(keyword) ? 1 : 0)
      })
      return row
    })
    rows.unshift(headerRow)
    return rows
  }

  @imemo
  get bytes() {
    return this.toString().length
  }

  @imemo
  get cachedErrors() {
    return this.errors
  }

  @imemo
  get keywordsTable() {
    const langsWithKeywords = this.topLanguages.filter(file =>
      file.has("keywords")
    )
    const langsWithKeywordsCount = langsWithKeywords.length

    const keywordsMap = {}
    langsWithKeywords.forEach(file => {
      file.keywords.forEach(keyword => {
        const keywordKey = "Q" + keyword // b.c. you cannot have a key "constructor" in JS objects.

        if (!keywordsMap[keywordKey])
          keywordsMap[keywordKey] = {
            keyword,
            ids: []
          }

        const row = keywordsMap[keywordKey]

        row.ids.push(file.id)
      })
    })

    const rows = Object.values(keywordsMap)
    rows.forEach((row: any) => {
      row.count = row.ids.length
      row.langs = row.ids
        .map(id => {
          const file = this.getFile(id)
          return `<a href='../languages/${file.permalink}'>${file.title}</a>`
        })
        .join(" ")
      row.frequency =
        Math.round(100 * lodash.round(row.count / langsWithKeywordsCount, 2)) +
        "%"
    })

    return {
      langsWithKeywordsCount,
      rows: lodash.sortBy(rows, "count").reverse()
    }
  }

  // todo: move upstream to TreeBase or Grammar
  prettifyContent(original: string) {
    const { sortIndices, sortSections } = this
    const noReturnChars = original.replace(/\r/g, "")
    const noBlankLines = noReturnChars
      .replace(/\n\n+/g, "\n")
      .replace(/\n$/, "")
    const programParser = this.grammarProgramConstructor
    const program = new programParser(noBlankLines)

    program.sort((nodeA, nodeB) => {
      const aIndex = sortIndices.get(nodeA.getFirstWord())
      const bIndex = sortIndices.get(nodeB.getFirstWord())
      if (aIndex === undefined) {
        console.error(`sortTemplate is missing "${nodeA.getFirstWord()}"`)
      }
      const a = aIndex ?? 1000
      const b = bIndex ?? 1000
      return a > b ? 1 : a < b ? -1 : nodeA.getLine() > nodeB.getLine()
    })

    // pad sections
    let currentSection = 0
    program.forEach(node => {
      const nodeSection = sortSections.get(node.getFirstWord())
      const sectionHasAdvanced = nodeSection > currentSection
      if (sectionHasAdvanced) {
        currentSection = nodeSection
        node.prependSibling("") // Put a blank line before this section
      }
    })

    return program.toString()
  }
}

export { PLDBBaseFolder, PLDBFile }
