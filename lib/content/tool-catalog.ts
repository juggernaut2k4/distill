/**
 * Hierarchical tool/language catalog.
 * Domain → Category → Topic → Lessons (each lesson = one visual slide, ~10-15 min).
 */

export interface Lesson {
  id: string
  title: string
  estimatedMinutes: number
}

export interface CatalogTopic {
  id: string
  title: string
  lessons: Lesson[]
}

export interface CatalogCategory {
  id: string
  title: string
  topics: CatalogTopic[]
}

export interface CatalogDomain {
  id: string
  title: string
  description: string
  emoji: string
  tags: string[]
  categories: CatalogCategory[]
}

function lesson(id: string, title: string, min = 10): Lesson {
  return { id, title, estimatedMinutes: min }
}

// ─── JAVA ─────────────────────────────────────────────────────────────────────

const java: CatalogDomain = {
  id: 'java',
  title: 'Java',
  emoji: '☕',
  description: "The world's most widely deployed language for enterprise backends, Android, and large-scale systems.",
  tags: ['Backend', 'Enterprise', 'Language'],
  categories: [
    {
      id: 'java-fundamentals',
      title: 'Fundamentals',
      topics: [
        {
          id: 'java-setup',
          title: 'Setup & Hello World',
          lessons: [
            lesson('java-setup-jdk', 'Installing JDK 21'),
            lesson('java-setup-ide', 'IDE setup: IntelliJ IDEA'),
            lesson('java-setup-hello', 'First Java program structure'),
            lesson('java-setup-main', 'The main() method explained'),
            lesson('java-setup-cli', 'Compiling & running from CLI'),
          ],
        },
        {
          id: 'java-datatypes',
          title: 'Variables & Data Types',
          lessons: [
            lesson('java-dt-int', 'int / long / short / byte'),
            lesson('java-dt-double', 'double / float'),
            lesson('java-dt-bool', 'boolean'),
            lesson('java-dt-char', 'char & Unicode'),
            lesson('java-dt-var', 'var keyword (Java 10+)'),
            lesson('java-dt-declare', 'Variable declaration & initialisation'),
          ],
        },
        {
          id: 'java-casting',
          title: 'Type Casting',
          lessons: [
            lesson('java-cast-widen', 'Widening conversion (implicit)'),
            lesson('java-cast-narrow', 'Narrowing conversion (explicit cast)'),
            lesson('java-cast-parse', 'parseInt() and String conversions'),
            lesson('java-cast-overflow', 'Overflow behaviour'),
          ],
        },
        {
          id: 'java-operators',
          title: 'Operators',
          lessons: [
            lesson('java-op-arith', 'Arithmetic operators (+, -, *, /, %)'),
            lesson('java-op-incr', 'Increment & decrement (++, --)'),
            lesson('java-op-compare', 'Comparison operators (==, !=, <, >, <=, >=)'),
            lesson('java-op-logical', 'Logical operators (&&, ||, !)'),
            lesson('java-op-bitwise', 'Bitwise operators (&, |, ^, ~, <<, >>)'),
            lesson('java-op-precedence', 'Operator precedence'),
          ],
        },
        {
          id: 'java-conditionals',
          title: 'Conditional Statements',
          lessons: [
            lesson('java-cond-if', 'if statement'),
            lesson('java-cond-ifelse', 'if-else'),
            lesson('java-cond-elseif', 'else-if chain'),
            lesson('java-cond-switch', 'switch statement (traditional)'),
            lesson('java-cond-switch-expr', 'switch expressions (Java 14+)'),
            lesson('java-cond-ternary', 'ternary operator (?:)'),
            lesson('java-cond-pattern', 'Pattern matching in switch (Java 21)'),
          ],
        },
        {
          id: 'java-loops',
          title: 'Loops',
          lessons: [
            lesson('java-loop-for', 'for loop'),
            lesson('java-loop-while', 'while loop'),
            lesson('java-loop-dowhile', 'do-while loop'),
            lesson('java-loop-foreach', 'enhanced for-each loop'),
            lesson('java-loop-break', 'break statement'),
            lesson('java-loop-continue', 'continue statement'),
            lesson('java-loop-labeled', 'Labeled break & continue'),
          ],
        },
        {
          id: 'java-methods',
          title: 'Methods',
          lessons: [
            lesson('java-meth-declare', 'Method declaration & signature'),
            lesson('java-meth-params', 'Parameters vs arguments'),
            lesson('java-meth-return', 'Return types & void'),
            lesson('java-meth-overload', 'Method overloading'),
            lesson('java-meth-varargs', 'Varargs (...)'),
            lesson('java-meth-pass', 'Pass by value vs reference'),
          ],
        },
        {
          id: 'java-arrays',
          title: 'Arrays',
          lessons: [
            lesson('java-arr-declare', 'Declaring & initialising arrays'),
            lesson('java-arr-access', 'Accessing & updating elements'),
            lesson('java-arr-length', 'Array length property'),
            lesson('java-arr-2d', 'Multi-dimensional arrays (2D)'),
            lesson('java-arr-util', 'Arrays utility class (sort, fill, copyOf)'),
          ],
        },
        {
          id: 'java-strings',
          title: 'Strings',
          lessons: [
            lesson('java-str-immut', 'String immutability'),
            lesson('java-str-methods', 'length() charAt() substring()'),
            lesson('java-str-search', 'indexOf() contains() startsWith() endsWith()'),
            lesson('java-str-mutate', 'replace() replaceAll() split()'),
            lesson('java-str-trim', 'trim() strip() stripLeading()'),
            lesson('java-str-format', 'String.format() & formatted()'),
            lesson('java-str-join', 'String.join()'),
            lesson('java-str-sb', 'StringBuilder (append, insert, delete, reverse)'),
            lesson('java-str-compare', 'String comparison (== vs equals())'),
          ],
        },
      ],
    },
    {
      id: 'java-oop',
      title: 'Object-Oriented Programming',
      topics: [
        {
          id: 'java-classes',
          title: 'Classes & Objects',
          lessons: [
            lesson('java-cls-define', 'Class definition'),
            lesson('java-cls-new', 'Creating objects with new'),
            lesson('java-cls-instance', 'Instance variables vs local variables'),
            lesson('java-cls-this', 'this keyword'),
            lesson('java-cls-null', 'Object references & null'),
          ],
        },
        {
          id: 'java-constructors',
          title: 'Constructors',
          lessons: [
            lesson('java-ctor-default', 'Default constructor'),
            lesson('java-ctor-param', 'Parameterised constructors'),
            lesson('java-ctor-chain', 'Constructor chaining with this()'),
            lesson('java-ctor-copy', 'Copy constructor pattern'),
          ],
        },
        {
          id: 'java-encapsulation',
          title: 'Encapsulation',
          lessons: [
            lesson('java-enc-access', 'Access modifiers (public / private / protected / package-private)'),
            lesson('java-enc-getset', 'Getter & setter methods'),
            lesson('java-enc-hiding', 'Data hiding benefits'),
          ],
        },
        {
          id: 'java-inheritance',
          title: 'Inheritance',
          lessons: [
            lesson('java-inh-extends', 'extends keyword'),
            lesson('java-inh-super', 'super keyword & super()'),
            lesson('java-inh-override', 'Method overriding'),
            lesson('java-inh-annotation', '@Override annotation'),
            lesson('java-inh-final', 'final class & final method'),
          ],
        },
        {
          id: 'java-polymorphism',
          title: 'Polymorphism',
          lessons: [
            lesson('java-poly-compile', 'Compile-time polymorphism (overloading)'),
            lesson('java-poly-runtime', 'Runtime polymorphism (overriding)'),
            lesson('java-poly-dispatch', 'Dynamic method dispatch'),
            lesson('java-poly-instanceof', 'instanceof operator'),
          ],
        },
        {
          id: 'java-abstract',
          title: 'Abstract Classes',
          lessons: [
            lesson('java-abs-keyword', 'abstract keyword'),
            lesson('java-abs-methods', 'Abstract vs concrete methods'),
            lesson('java-abs-extend', 'Extending abstract classes'),
            lesson('java-abs-when', 'When to use abstract class'),
          ],
        },
        {
          id: 'java-interfaces',
          title: 'Interfaces',
          lessons: [
            lesson('java-iface-define', 'Interface definition & implements'),
            lesson('java-iface-default', 'Default methods (Java 8+)'),
            lesson('java-iface-static', 'Static interface methods'),
            lesson('java-iface-functional', 'Functional interfaces (@FunctionalInterface)'),
            lesson('java-iface-multi', 'Multiple interface implementation'),
            lesson('java-iface-vs-abs', 'Interface vs abstract class'),
          ],
        },
        {
          id: 'java-enums',
          title: 'Enums',
          lessons: [
            lesson('java-enum-declare', 'Enum declaration'),
            lesson('java-enum-fields', 'Enum fields & methods'),
            lesson('java-enum-switch', 'Enum in switch'),
            lesson('java-enum-collections', 'EnumSet & EnumMap'),
          ],
        },
      ],
    },
    {
      id: 'java-collections',
      title: 'Collections Framework',
      topics: [
        {
          id: 'java-list',
          title: 'List',
          lessons: [
            lesson('java-list-arraylist', 'ArrayList basics'),
            lesson('java-list-linkedlist', 'LinkedList basics'),
            lesson('java-list-of', 'List.of() & List.copyOf()'),
            lesson('java-list-ops', 'add() remove() get() set() contains() size()'),
            lesson('java-list-iterate', 'Iteration (for-each, iterator, forEach)'),
            lesson('java-list-sort', 'Collections.sort() & Comparator'),
          ],
        },
        {
          id: 'java-set',
          title: 'Set',
          lessons: [
            lesson('java-set-hashset', 'HashSet (no duplicates, no order)'),
            lesson('java-set-treeset', 'TreeSet (sorted)'),
            lesson('java-set-linked', 'LinkedHashSet (insertion order)'),
            lesson('java-set-ops', 'Set operations (contains, add, remove)'),
          ],
        },
        {
          id: 'java-map',
          title: 'Map',
          lessons: [
            lesson('java-map-hashmap', 'HashMap basics'),
            lesson('java-map-treemap', 'TreeMap (sorted keys)'),
            lesson('java-map-linked', 'LinkedHashMap'),
            lesson('java-map-of', 'Map.of()'),
            lesson('java-map-ops', 'put() get() remove() containsKey() containsValue()'),
            lesson('java-map-iterate', 'keySet() values() entrySet() iteration'),
            lesson('java-map-merge', 'Map.merge() & computeIfAbsent()'),
          ],
        },
        {
          id: 'java-queue',
          title: 'Queue & Deque',
          lessons: [
            lesson('java-queue-interface', 'Queue interface'),
            lesson('java-queue-arraydeque', 'ArrayDeque'),
            lesson('java-queue-priority', 'PriorityQueue'),
            lesson('java-queue-stack', 'Stack (prefer Deque)'),
          ],
        },
        {
          id: 'java-generics',
          title: 'Generics',
          lessons: [
            lesson('java-gen-class', 'Generic class syntax <T>'),
            lesson('java-gen-methods', 'Generic methods'),
            lesson('java-gen-bounded', 'Bounded type parameters (<T extends Comparable>)'),
            lesson('java-gen-wildcard', 'Wildcards (?, ? extends, ? super)'),
            lesson('java-gen-erasure', 'Type erasure explained'),
          ],
        },
        {
          id: 'java-exceptions',
          title: 'Exception Handling',
          lessons: [
            lesson('java-exc-try', 'try-catch basics'),
            lesson('java-exc-multi', 'Multiple catch blocks'),
            lesson('java-exc-finally', 'finally block'),
            lesson('java-exc-checked', 'Checked vs unchecked exceptions'),
            lesson('java-exc-custom', 'Custom exceptions (extends Exception / RuntimeException)'),
            lesson('java-exc-twr', 'try-with-resources'),
            lesson('java-exc-chain', 'Exception chaining (cause)'),
          ],
        },
      ],
    },
    {
      id: 'java-modern',
      title: 'Modern Java (8+)',
      topics: [
        {
          id: 'java-lambda',
          title: 'Lambda Expressions',
          lessons: [
            lesson('java-lam-syntax', 'Lambda syntax (params) -> expression'),
            lesson('java-lam-block', 'Block lambdas'),
            lesson('java-lam-methref', 'Method references (Class::method, obj::method, Class::new)'),
          ],
        },
        {
          id: 'java-functional',
          title: 'Built-in Functional Interfaces',
          lessons: [
            lesson('java-fi-predicate', 'Predicate<T> — test()'),
            lesson('java-fi-function', 'Function<T,R> — apply()'),
            lesson('java-fi-consumer', 'Consumer<T> — accept()'),
            lesson('java-fi-supplier', 'Supplier<T> — get()'),
            lesson('java-fi-bi', 'BiFunction<T,U,R> & UnaryOperator<T>'),
          ],
        },
        {
          id: 'java-streams',
          title: 'Streams API',
          lessons: [
            lesson('java-stream-create', 'Stream creation (of, list.stream, generate, iterate)'),
            lesson('java-stream-filter', 'filter() & map()'),
            lesson('java-stream-flatmap', 'flatMap()'),
            lesson('java-stream-sorted', 'sorted() distinct() limit() skip()'),
            lesson('java-stream-collect', 'collect() with Collectors'),
            lesson('java-stream-terminal', 'forEach() reduce() count() min() max()'),
            lesson('java-stream-match', 'findFirst() anyMatch() allMatch() noneMatch()'),
            lesson('java-stream-collectors', 'groupingBy() partitioningBy() joining()'),
            lesson('java-stream-parallel', 'Parallel streams'),
          ],
        },
        {
          id: 'java-optional',
          title: 'Optional',
          lessons: [
            lesson('java-opt-create', 'Optional.of() empty() ofNullable()'),
            lesson('java-opt-check', 'isPresent() isEmpty() get()'),
            lesson('java-opt-else', 'orElse() orElseGet() orElseThrow()'),
            lesson('java-opt-transform', 'map() flatMap() filter()'),
            lesson('java-opt-ifpresent', 'ifPresent() ifPresentOrElse()'),
          ],
        },
        {
          id: 'java-datetime',
          title: 'Date & Time API',
          lessons: [
            lesson('java-dt-localdate', 'LocalDate'),
            lesson('java-dt-localtime', 'LocalTime & LocalDateTime'),
            lesson('java-dt-zoned', 'ZonedDateTime & ZoneId'),
            lesson('java-dt-duration', 'Duration & Period'),
            lesson('java-dt-format', 'DateTimeFormatter (format & parse)'),
          ],
        },
        {
          id: 'java-records',
          title: 'Records (Java 16+)',
          lessons: [
            lesson('java-rec-syntax', 'Record syntax'),
            lesson('java-rec-compact', 'Compact constructors'),
            lesson('java-rec-custom', 'Custom methods on records'),
            lesson('java-rec-vs-pojo', 'Records vs POJOs'),
          ],
        },
        {
          id: 'java-sealed',
          title: 'Sealed Classes (Java 17+)',
          lessons: [
            lesson('java-sealed-syntax', 'sealed & permits keywords'),
            lesson('java-sealed-pattern', 'Pattern matching with sealed classes'),
            lesson('java-sealed-switch', 'Switch expressions with sealed types'),
          ],
        },
      ],
    },
    {
      id: 'java-concurrency',
      title: 'Concurrency',
      topics: [
        {
          id: 'java-threads',
          title: 'Threads',
          lessons: [
            lesson('java-thr-create', 'Thread class & Runnable'),
            lesson('java-thr-start', 'Creating & starting threads'),
            lesson('java-thr-sleep', 'Thread.sleep() & join()'),
            lesson('java-thr-lifecycle', 'Thread states (lifecycle)'),
            lesson('java-thr-daemon', 'Daemon threads'),
          ],
        },
        {
          id: 'java-sync',
          title: 'Synchronisation',
          lessons: [
            lesson('java-sync-race', 'Race conditions explained'),
            lesson('java-sync-sync', 'synchronized methods & blocks'),
            lesson('java-sync-volatile', 'volatile keyword'),
            lesson('java-sync-lock', 'ReentrantLock'),
            lesson('java-sync-atomic', 'AtomicInteger / AtomicLong / AtomicBoolean'),
          ],
        },
        {
          id: 'java-executor',
          title: 'Executor Framework',
          lessons: [
            lesson('java-exec-service', 'ExecutorService'),
            lesson('java-exec-factory', 'Executors factory methods'),
            lesson('java-exec-future', 'submit() & Future<T>'),
            lesson('java-exec-callable', 'Callable<T>'),
            lesson('java-exec-shutdown', 'shutdown() & awaitTermination()'),
          ],
        },
        {
          id: 'java-completable',
          title: 'CompletableFuture',
          lessons: [
            lesson('java-cf-create', 'supplyAsync() & runAsync()'),
            lesson('java-cf-then', 'thenApply() thenAccept() thenRun()'),
            lesson('java-cf-combine', 'thenCombine() & allOf()'),
            lesson('java-cf-error', 'exceptionally() & handle()'),
            lesson('java-cf-chain', 'CompletableFuture chaining'),
          ],
        },
      ],
    },
    {
      id: 'java-testing',
      title: 'Testing',
      topics: [
        {
          id: 'java-junit5',
          title: 'JUnit 5',
          lessons: [
            lesson('java-junit-test', '@Test & assertions (assertEquals, assertThrows)'),
            lesson('java-junit-lifecycle', '@BeforeEach @AfterEach @BeforeAll @AfterAll'),
            lesson('java-junit-param', '@ParameterizedTest with @ValueSource / @CsvSource'),
            lesson('java-junit-nested', '@Nested test classes'),
            lesson('java-junit-display', '@DisplayName & @Disabled'),
          ],
        },
        {
          id: 'java-mockito',
          title: 'Mockito',
          lessons: [
            lesson('java-mock-create', 'Creating mocks with mock() & @Mock'),
            lesson('java-mock-stub', 'Stubbing with when().thenReturn()'),
            lesson('java-mock-verify', 'verify() interactions'),
            lesson('java-mock-inject', '@InjectMocks'),
            lesson('java-mock-captor', 'ArgumentCaptor'),
          ],
        },
      ],
    },
  ],
}

// ─── JAVASCRIPT ───────────────────────────────────────────────────────────────

const javascript: CatalogDomain = {
  id: 'javascript',
  title: 'JavaScript',
  emoji: '🟨',
  description: "The language of the web — from simple scripts to full-stack applications and serverless functions.",
  tags: ['Frontend', 'Backend', 'Language'],
  categories: [
    {
      id: 'js-fundamentals',
      title: 'Fundamentals',
      topics: [
        {
          id: 'js-variables',
          title: 'Variables',
          lessons: [
            lesson('js-var-var', 'var (function scope, hoisted)'),
            lesson('js-var-let', 'let (block scope)'),
            lesson('js-var-const', 'const (block scope, no reassign)'),
            lesson('js-var-tdz', 'Temporal dead zone'),
            lesson('js-var-best', 'Best practices (prefer const)'),
          ],
        },
        {
          id: 'js-datatypes',
          title: 'Data Types',
          lessons: [
            lesson('js-dt-primitives', 'string, number, boolean'),
            lesson('js-dt-nullundef', 'null vs undefined'),
            lesson('js-dt-symbol', 'symbol & bigint'),
            lesson('js-dt-typeof', 'typeof operator'),
            lesson('js-dt-coercion', 'Type coercion basics'),
          ],
        },
        {
          id: 'js-operators',
          title: 'Operators',
          lessons: [
            lesson('js-op-arith', 'Arithmetic operators'),
            lesson('js-op-compare', 'Comparison (== vs ===)'),
            lesson('js-op-logical', 'Logical (&&, ||, ??)'),
            lesson('js-op-optional', 'Optional chaining (?.)'),
            lesson('js-op-spread', 'Spread (...) & Rest (...params)'),
            lesson('js-op-assign', 'Logical assignment (||=, &&=, ??=)'),
          ],
        },
        {
          id: 'js-conditionals',
          title: 'Conditional Statements',
          lessons: [
            lesson('js-cond-if', 'if-else'),
            lesson('js-cond-ternary', 'ternary operator'),
            lesson('js-cond-switch', 'switch statement'),
            lesson('js-cond-nullish', 'Nullish coalescing (??)'),
          ],
        },
        {
          id: 'js-loops',
          title: 'Loops',
          lessons: [
            lesson('js-loop-for', 'for loop'),
            lesson('js-loop-forof', 'for...of (iterables)'),
            lesson('js-loop-forin', 'for...in (object keys)'),
            lesson('js-loop-while', 'while & do-while'),
            lesson('js-loop-array', 'Array iteration methods (forEach, map, filter, reduce)'),
          ],
        },
        {
          id: 'js-functions',
          title: 'Functions',
          lessons: [
            lesson('js-fn-declare', 'Function declarations vs expressions'),
            lesson('js-fn-arrow', 'Arrow functions (=>)'),
            lesson('js-fn-default', 'Default parameters'),
            lesson('js-fn-rest', 'Rest parameters'),
            lesson('js-fn-iife', 'IIFEs'),
          ],
        },
        {
          id: 'js-scope',
          title: 'Scope & Closures',
          lessons: [
            lesson('js-scope-global', 'Global scope'),
            lesson('js-scope-function', 'Function scope'),
            lesson('js-scope-block', 'Block scope'),
            lesson('js-scope-lexical', 'Lexical scope'),
            lesson('js-scope-closure', 'Closure concept'),
            lesson('js-scope-use', 'Closure practical uses'),
          ],
        },
        {
          id: 'js-hoisting',
          title: 'Hoisting',
          lessons: [
            lesson('js-hoist-var', 'var hoisting'),
            lesson('js-hoist-fn', 'Function declaration hoisting'),
            lesson('js-hoist-tdz', 'TDZ for let/const'),
          ],
        },
        {
          id: 'js-this',
          title: 'this keyword',
          lessons: [
            lesson('js-this-global', 'Global context'),
            lesson('js-this-method', 'Object method context'),
            lesson('js-this-arrow', 'Arrow functions (no own this)'),
            lesson('js-this-bind', 'bind() call() apply()'),
            lesson('js-this-class', 'this in classes'),
          ],
        },
      ],
    },
    {
      id: 'js-es6',
      title: 'ES6+ Features',
      topics: [
        {
          id: 'js-destructuring',
          title: 'Destructuring',
          lessons: [
            lesson('js-des-array', 'Array destructuring'),
            lesson('js-des-object', 'Object destructuring'),
            lesson('js-des-default', 'Default values in destructuring'),
            lesson('js-des-rename', 'Renaming in destructuring'),
            lesson('js-des-nested', 'Nested destructuring'),
          ],
        },
        {
          id: 'js-spread',
          title: 'Spread & Rest',
          lessons: [
            lesson('js-spr-array', 'Spread arrays'),
            lesson('js-spr-object', 'Spread objects'),
            lesson('js-spr-rest', 'Rest in functions'),
            lesson('js-spr-combine', 'Combining arrays/objects'),
          ],
        },
        {
          id: 'js-template',
          title: 'Template Literals',
          lessons: [
            lesson('js-tmpl-interp', 'String interpolation (${ })'),
            lesson('js-tmpl-multi', 'Multi-line strings'),
            lesson('js-tmpl-tagged', 'Tagged template literals'),
          ],
        },
        {
          id: 'js-classes',
          title: 'Classes',
          lessons: [
            lesson('js-cls-syntax', 'class syntax & constructor'),
            lesson('js-cls-extends', 'extends (inheritance) & super'),
            lesson('js-cls-static', 'static methods'),
            lesson('js-cls-private', 'Private fields (#)'),
          ],
        },
        {
          id: 'js-modules',
          title: 'Modules',
          lessons: [
            lesson('js-mod-export', 'export (named & default)'),
            lesson('js-mod-import', 'import syntax'),
            lesson('js-mod-dynamic', 'Dynamic import()'),
            lesson('js-mod-scope', 'Module scope'),
          ],
        },
        {
          id: 'js-generators',
          title: 'Iterators & Generators',
          lessons: [
            lesson('js-gen-iterable', 'Iterable protocol ([Symbol.iterator])'),
            lesson('js-gen-iterator', 'Iterator protocol (next())'),
            lesson('js-gen-function', 'Generator functions (function*)'),
            lesson('js-gen-yield', 'yield'),
            lesson('js-gen-infinite', 'Infinite generators'),
          ],
        },
      ],
    },
    {
      id: 'js-async',
      title: 'Async JavaScript',
      topics: [
        {
          id: 'js-callbacks',
          title: 'Callbacks',
          lessons: [
            lesson('js-cb-pattern', 'Callback pattern'),
            lesson('js-cb-hell', 'Callback hell (pyramid of doom)'),
            lesson('js-cb-errorfirst', 'Error-first callbacks'),
          ],
        },
        {
          id: 'js-promises',
          title: 'Promises',
          lessons: [
            lesson('js-prom-create', 'new Promise(), resolve & reject'),
            lesson('js-prom-then', '.then() .catch() .finally()'),
            lesson('js-prom-all', 'Promise.all()'),
            lesson('js-prom-race', 'Promise.race()'),
            lesson('js-prom-allsettled', 'Promise.allSettled()'),
            lesson('js-prom-any', 'Promise.any()'),
          ],
        },
        {
          id: 'js-asyncawait',
          title: 'Async/Await',
          lessons: [
            lesson('js-aa-async', 'async function'),
            lesson('js-aa-await', 'await keyword'),
            lesson('js-aa-trycatch', 'Error handling with try/catch'),
            lesson('js-aa-parallel', 'Parallel with Promise.all in async'),
            lesson('js-aa-toplevel', 'Top-level await'),
          ],
        },
        {
          id: 'js-eventloop',
          title: 'Event Loop',
          lessons: [
            lesson('js-el-callstack', 'Call stack'),
            lesson('js-el-webapis', 'Web APIs'),
            lesson('js-el-macrotask', 'Callback queue (macrotask)'),
            lesson('js-el-microtask', 'Microtask queue'),
            lesson('js-el-tick', 'Event loop tick'),
            lesson('js-el-order', 'setTimeout vs Promise ordering'),
          ],
        },
        {
          id: 'js-fetch',
          title: 'Fetch API',
          lessons: [
            lesson('js-fetch-basics', 'fetch() basics'),
            lesson('js-fetch-response', 'Response methods (.json(), .text(), .blob())'),
            lesson('js-fetch-error', 'Error handling (no auto-throw on 4xx/5xx)'),
            lesson('js-fetch-options', 'Headers & options (method, body, headers)'),
            lesson('js-fetch-abort', 'AbortController'),
          ],
        },
      ],
    },
    {
      id: 'js-arrays-objects',
      title: 'Arrays & Objects',
      topics: [
        {
          id: 'js-array-transform',
          title: 'Array — Transformation',
          lessons: [
            lesson('js-arr-map', 'map()'),
            lesson('js-arr-filter', 'filter()'),
            lesson('js-arr-reduce', 'reduce()'),
            lesson('js-arr-flatmap', 'flatMap() & flat()'),
            lesson('js-arr-from', 'Array.from() & Array.of()'),
          ],
        },
        {
          id: 'js-array-search',
          title: 'Array — Search',
          lessons: [
            lesson('js-arr-find', 'find() & findIndex()'),
            lesson('js-arr-includes', 'includes() & indexOf()'),
            lesson('js-arr-some', 'some() & every()'),
          ],
        },
        {
          id: 'js-array-mutation',
          title: 'Array — Mutation',
          lessons: [
            lesson('js-arr-pushpop', 'push() pop() shift() unshift()'),
            lesson('js-arr-splice', 'splice()'),
            lesson('js-arr-sort', 'sort() (stable in modern engines)'),
            lesson('js-arr-reverse', 'reverse() & fill()'),
          ],
        },
        {
          id: 'js-object-methods',
          title: 'Object Methods',
          lessons: [
            lesson('js-obj-keys', 'Object.keys() values() entries()'),
            lesson('js-obj-assign', 'Object.assign()'),
            lesson('js-obj-freeze', 'Object.freeze() & Object.seal()'),
            lesson('js-obj-create', 'Object.create()'),
            lesson('js-obj-clone', 'structuredClone()'),
          ],
        },
        {
          id: 'js-prototypes',
          title: 'Prototypes',
          lessons: [
            lesson('js-proto-chain', 'Prototype chain'),
            lesson('js-proto-getproto', 'Object.getPrototypeOf()'),
            lesson('js-proto-inherit', 'Prototype-based inheritance'),
            lesson('js-proto-class', 'class syntax vs prototype'),
          ],
        },
      ],
    },
    {
      id: 'js-errors',
      title: 'Error Handling & Tooling',
      topics: [
        {
          id: 'js-error-types',
          title: 'Error Types',
          lessons: [
            lesson('js-err-types', 'Error, TypeError, RangeError, SyntaxError, ReferenceError'),
            lesson('js-err-custom', 'Custom errors (extends Error)'),
          ],
        },
        {
          id: 'js-trycatch',
          title: 'try-catch-finally',
          lessons: [
            lesson('js-try-catch', 'catch(e) with error object'),
            lesson('js-try-finally', 'finally guarantees'),
            lesson('js-try-rethrow', 'Re-throwing errors'),
            lesson('js-try-stack', 'Error.stack'),
          ],
        },
        {
          id: 'js-debugging',
          title: 'Debugging',
          lessons: [
            lesson('js-debug-console', 'console methods (log, warn, error, table, group, time)'),
            lesson('js-debug-debugger', 'debugger statement'),
            lesson('js-debug-devtools', 'Breakpoints in DevTools'),
          ],
        },
        {
          id: 'js-regex',
          title: 'Regular Expressions',
          lessons: [
            lesson('js-regex-syntax', 'Literal & constructor syntax'),
            lesson('js-regex-classes', 'Character classes'),
            lesson('js-regex-quantifiers', 'Quantifiers'),
            lesson('js-regex-groups', 'Groups & capturing'),
            lesson('js-regex-flags', 'Flags (g, i, m, s)'),
            lesson('js-regex-string', 'String.match() search() replace() split() with regex'),
          ],
        },
      ],
    },
  ],
}

// ─── REACT ────────────────────────────────────────────────────────────────────

const react: CatalogDomain = {
  id: 'react',
  title: 'React',
  emoji: '⚛️',
  description: "The most popular UI library for building component-based web applications.",
  tags: ['Frontend', 'UI', 'Framework'],
  categories: [
    {
      id: 'react-fundamentals',
      title: 'Fundamentals',
      topics: [
        {
          id: 'react-jsx',
          title: 'JSX',
          lessons: [
            lesson('react-jsx-syntax', 'JSX syntax'),
            lesson('react-jsx-expr', 'Expressions in JSX ({})'),
            lesson('react-jsx-vs-html', 'JSX vs HTML differences (className, htmlFor, self-closing)'),
            lesson('react-jsx-fragments', 'Fragments (<> </>)'),
            lesson('react-jsx-compile', 'JSX compilation (React.createElement)'),
          ],
        },
        {
          id: 'react-components',
          title: 'Functional Components',
          lessons: [
            lesson('react-comp-syntax', 'Function syntax'),
            lesson('react-comp-naming', 'Component naming (PascalCase)'),
            lesson('react-comp-return', 'Returning JSX'),
            lesson('react-comp-hierarchy', 'Component hierarchy'),
          ],
        },
        {
          id: 'react-props',
          title: 'Props',
          lessons: [
            lesson('react-props-pass', 'Passing props'),
            lesson('react-props-access', 'Accessing props'),
            lesson('react-props-default', 'Default props'),
            lesson('react-props-ts', 'Prop types with TypeScript'),
            lesson('react-props-children', 'Children prop (ReactNode)'),
            lesson('react-props-spread', 'Spreading props'),
          ],
        },
        {
          id: 'react-state',
          title: 'State with useState',
          lessons: [
            lesson('react-state-hook', 'useState hook syntax'),
            lesson('react-state-update', 'Reading & updating state'),
            lesson('react-state-immutable', 'State is snapshot (immutable)'),
            lesson('react-state-batch', 'Batching updates'),
            lesson('react-state-multi', 'Multiple state variables'),
            lesson('react-state-obj', 'Object & array state'),
          ],
        },
        {
          id: 'react-conditional',
          title: 'Conditional Rendering',
          lessons: [
            lesson('react-cond-ifelse', 'if/else return patterns'),
            lesson('react-cond-ternary', 'Ternary in JSX'),
            lesson('react-cond-and', '&& short-circuit'),
            lesson('react-cond-null', 'null/undefined returns nothing'),
          ],
        },
        {
          id: 'react-lists',
          title: 'Lists & Keys',
          lessons: [
            lesson('react-lists-map', 'Rendering arrays with .map()'),
            lesson('react-lists-key', 'key prop requirement'),
            lesson('react-lists-keybest', 'Key best practices (stable, unique)'),
            lesson('react-lists-index', 'Index as key (when OK)'),
          ],
        },
        {
          id: 'react-events',
          title: 'Events',
          lessons: [
            lesson('react-ev-handlers', 'onClick, onChange, onSubmit'),
            lesson('react-ev-synthetic', 'Synthetic events'),
            lesson('react-ev-args', 'Passing arguments to handlers'),
            lesson('react-ev-prevent', 'Preventing defaults'),
          ],
        },
      ],
    },
    {
      id: 'react-hooks',
      title: 'Hooks',
      topics: [
        {
          id: 'react-useeffect',
          title: 'useEffect',
          lessons: [
            lesson('react-eff-syntax', 'Effect syntax'),
            lesson('react-eff-deps', 'Dependency array ([], [dep], no array)'),
            lesson('react-eff-cleanup', 'Cleanup function (return)'),
            lesson('react-eff-fetch', 'Fetching data in effect'),
            lesson('react-eff-mistakes', 'Common mistakes (missing deps, infinite loops)'),
          ],
        },
        {
          id: 'react-usecontext',
          title: 'useContext',
          lessons: [
            lesson('react-ctx-create', 'createContext'),
            lesson('react-ctx-provider', 'Provider'),
            lesson('react-ctx-consume', 'Consuming with useContext'),
            lesson('react-ctx-default', 'Context default value'),
            lesson('react-ctx-perf', 'Performance considerations'),
          ],
        },
        {
          id: 'react-useref',
          title: 'useRef',
          lessons: [
            lesson('react-ref-dom', 'DOM refs (ref={myRef})'),
            lesson('react-ref-mutable', 'Mutable ref (not re-rendered)'),
            lesson('react-ref-forward', 'forwardRef'),
          ],
        },
        {
          id: 'react-memo-cb',
          title: 'useMemo & useCallback',
          lessons: [
            lesson('react-memo-concept', 'Memoization concept'),
            lesson('react-memo-usememo', 'useMemo syntax'),
            lesson('react-memo-usecb', 'useCallback syntax'),
            lesson('react-memo-when', 'When to optimize (avoid premature)'),
          ],
        },
        {
          id: 'react-reducer',
          title: 'useReducer',
          lessons: [
            lesson('react-red-pattern', 'Reducer pattern'),
            lesson('react-red-dispatch', 'dispatch & action'),
            lesson('react-red-init', 'Initial state'),
            lesson('react-red-vs', 'useReducer vs useState'),
          ],
        },
        {
          id: 'react-custom-hooks',
          title: 'Custom Hooks',
          lessons: [
            lesson('react-ch-extract', 'Extracting hook logic'),
            lesson('react-ch-naming', 'Naming convention (use prefix)'),
            lesson('react-ch-usefetch', 'useFetch example'),
            lesson('react-ch-uselocal', 'useLocalStorage example'),
            lesson('react-ch-usedebounce', 'useDebounce example'),
          ],
        },
      ],
    },
    {
      id: 'react-patterns',
      title: 'Patterns & Performance',
      topics: [
        {
          id: 'react-memo-comp',
          title: 'React.memo',
          lessons: [
            lesson('react-memo-comp-when', 'When re-renders happen'),
            lesson('react-memo-comp-syntax', 'memo() syntax'),
            lesson('react-memo-comp-custom', 'Custom comparison function'),
          ],
        },
        {
          id: 'react-code-split',
          title: 'Code Splitting',
          lessons: [
            lesson('react-split-lazy', 'React.lazy()'),
            lesson('react-split-suspense', 'Suspense fallback'),
            lesson('react-split-route', 'Route-based splitting'),
          ],
        },
        {
          id: 'react-error-boundary',
          title: 'Error Boundaries',
          lessons: [
            lesson('react-eb-class', 'Class component requirement'),
            lesson('react-eb-catch', 'componentDidCatch'),
            lesson('react-eb-state', 'getDerivedStateFromError'),
            lesson('react-eb-fallback', 'Fallback UI'),
          ],
        },
        {
          id: 'react-forms',
          title: 'Forms',
          lessons: [
            lesson('react-form-controlled', 'Controlled input (value + onChange)'),
            lesson('react-form-submit', 'Form submission'),
            lesson('react-form-rhf', 'React Hook Form (useForm, register, handleSubmit)'),
            lesson('react-form-zod', 'Zod integration with RHF'),
          ],
        },
        {
          id: 'react-composition',
          title: 'Composition Patterns',
          lessons: [
            lesson('react-comp-vs-inherit', 'Component composition vs inheritance'),
            lesson('react-comp-render-props', 'Render props pattern'),
            lesson('react-comp-hoc', 'Higher-order components (HOC)'),
            lesson('react-comp-compound', 'Compound components'),
          ],
        },
      ],
    },
    {
      id: 'react-state-mgmt',
      title: 'State Management',
      topics: [
        {
          id: 'react-context-scale',
          title: 'Context API at Scale',
          lessons: [
            lesson('react-ctx-global', 'Global state with context'),
            lesson('react-ctx-split', 'Splitting contexts for performance'),
            lesson('react-ctx-limits', 'Limitations of context'),
          ],
        },
        {
          id: 'react-zustand',
          title: 'Zustand',
          lessons: [
            lesson('react-zus-create', 'Store creation with create()'),
            lesson('react-zus-read', 'Reading state & actions'),
            lesson('react-zus-async', 'Async actions'),
            lesson('react-zus-persist', 'Persist middleware'),
          ],
        },
        {
          id: 'react-redux',
          title: 'Redux Toolkit',
          lessons: [
            lesson('react-rtk-store', 'configureStore'),
            lesson('react-rtk-slice', 'createSlice (reducers + actions)'),
            lesson('react-rtk-hooks', 'useSelector & useDispatch'),
            lesson('react-rtk-thunk', 'createAsyncThunk'),
            lesson('react-rtk-query', 'RTK Query basics'),
          ],
        },
        {
          id: 'react-query',
          title: 'React Query (TanStack)',
          lessons: [
            lesson('react-rq-usequery', 'useQuery'),
            lesson('react-rq-keys', 'queryKey & queryFn'),
            lesson('react-rq-mutation', 'useMutation'),
            lesson('react-rq-invalidate', 'invalidateQueries'),
            lesson('react-rq-stale', 'Stale time & cache time'),
          ],
        },
      ],
    },
    {
      id: 'react-routing',
      title: 'Routing',
      topics: [
        {
          id: 'react-router-basics',
          title: 'React Router v6 — Basics',
          lessons: [
            lesson('react-rtr-setup', 'BrowserRouter, Routes + Route'),
            lesson('react-rtr-outlet', 'Outlet'),
            lesson('react-rtr-link', 'Link vs NavLink'),
            lesson('react-rtr-navigate', 'useNavigate & Navigate component'),
          ],
        },
        {
          id: 'react-router-advanced',
          title: 'React Router v6 — Advanced',
          lessons: [
            lesson('react-rtr-params', 'Dynamic routes & useParams'),
            lesson('react-rtr-nested', 'Nested routes & index routes'),
            lesson('react-rtr-search', 'useSearchParams'),
            lesson('react-rtr-protect', 'Protected routes'),
          ],
        },
      ],
    },
  ],
}

// ─── NEXT.JS ──────────────────────────────────────────────────────────────────

const nextjs: CatalogDomain = {
  id: 'nextjs',
  title: 'Next.js',
  emoji: '▲',
  description: "The React framework for production — App Router, Server Components, streaming, and deployment on Vercel.",
  tags: ['Frontend', 'Fullstack', 'Framework'],
  categories: [
    {
      id: 'next-app-router',
      title: 'App Router Fundamentals',
      topics: [
        {
          id: 'next-filebased',
          title: 'File-based Routing',
          lessons: [
            lesson('next-file-page', 'page.tsx'),
            lesson('next-file-layout', 'layout.tsx'),
            lesson('next-file-template', 'template.tsx'),
            lesson('next-file-loading', 'loading.tsx (Suspense)'),
            lesson('next-file-error', 'error.tsx (Error Boundary)'),
            lesson('next-file-notfound', 'not-found.tsx'),
            lesson('next-file-groups', 'Route groups ((folder))'),
            lesson('next-file-private', 'Private folders (_folder)'),
          ],
        },
        {
          id: 'next-rsc',
          title: 'Server vs Client Components',
          lessons: [
            lesson('next-rsc-default', 'RSC (Server Components) by default'),
            lesson('next-rsc-use-client', "'use client' directive"),
            lesson('next-rsc-when', 'When to use each'),
            lesson('next-rsc-compose', 'Composition patterns'),
            lesson('next-rsc-pass', 'Passing RSC as children to client'),
          ],
        },
        {
          id: 'next-navigation',
          title: 'Navigation',
          lessons: [
            lesson('next-nav-link', '<Link> component'),
            lesson('next-nav-router', 'useRouter (client-only)'),
            lesson('next-nav-pathname', 'usePathname'),
            lesson('next-nav-searchparams', 'useSearchParams (Suspense wrapper)'),
            lesson('next-nav-redirect', 'redirect() (server)'),
            lesson('next-nav-notfound', 'notFound()'),
          ],
        },
        {
          id: 'next-dynamic-routes',
          title: 'Dynamic Routes',
          lessons: [
            lesson('next-dyn-param', '[slug] parameter'),
            lesson('next-dyn-catchall', '[...slug] catch-all'),
            lesson('next-dyn-optional', '[[...slug]] optional catch-all'),
            lesson('next-dyn-gsp', 'generateStaticParams'),
          ],
        },
      ],
    },
    {
      id: 'next-data-fetching',
      title: 'Data Fetching',
      topics: [
        {
          id: 'next-fetch-rsc',
          title: 'fetch() in Server Components',
          lessons: [
            lesson('next-fetch-basic', 'fetch() with async RSC'),
            lesson('next-fetch-cache', 'force-cache (default)'),
            lesson('next-fetch-nostore', 'no-store'),
            lesson('next-fetch-revalidate', 'revalidate: N'),
            lesson('next-fetch-dedup', 'Deduplication of fetch'),
          ],
        },
        {
          id: 'next-parallel-data',
          title: 'Parallel & Sequential Fetching',
          lessons: [
            lesson('next-par-all', 'Parallel fetching with Promise.all'),
            lesson('next-par-seq', 'Sequential (await in component)'),
            lesson('next-par-preload', 'Preloading pattern'),
          ],
        },
        {
          id: 'next-server-actions',
          title: 'Server Actions',
          lessons: [
            lesson('next-sa-use-server', "'use server'"),
            lesson('next-sa-form', 'Form action attribute'),
            lesson('next-sa-client', 'Calling from client component'),
            lesson('next-sa-formstate', 'useFormState & useFormStatus'),
            lesson('next-sa-optimistic', 'Optimistic updates (useOptimistic)'),
            lesson('next-sa-error', 'Error handling'),
          ],
        },
      ],
    },
    {
      id: 'next-rendering',
      title: 'Rendering Strategies',
      topics: [
        {
          id: 'next-static',
          title: 'Static Generation (SSG)',
          lessons: [
            lesson('next-ssg-default', 'Default static rendering'),
            lesson('next-ssg-gsp', 'generateStaticParams'),
            lesson('next-ssg-dynamic', "export const dynamic = 'force-static'"),
          ],
        },
        {
          id: 'next-dynamic-render',
          title: 'Dynamic Rendering (SSR)',
          lessons: [
            lesson('next-dyn-force', 'force-dynamic'),
            lesson('next-dyn-triggers', 'cookies() / headers() triggers'),
            lesson('next-dyn-searchparams', 'searchParams trigger'),
            lesson('next-dyn-stream', 'Streaming with Suspense'),
          ],
        },
        {
          id: 'next-isr',
          title: 'Incremental Static Regeneration',
          lessons: [
            lesson('next-isr-fetch', 'revalidate in fetch'),
            lesson('next-isr-route', 'export const revalidate'),
            lesson('next-isr-demand', 'On-demand (revalidatePath, revalidateTag)'),
          ],
        },
        {
          id: 'next-ppr',
          title: 'Partial Prerendering',
          lessons: [
            lesson('next-ppr-concept', 'Static shell + dynamic holes concept'),
            lesson('next-ppr-suspense', 'Suspense as PPR boundary'),
            lesson('next-ppr-config', 'experimental_ppr flag'),
          ],
        },
      ],
    },
    {
      id: 'next-api',
      title: 'API & Middleware',
      topics: [
        {
          id: 'next-route-handlers',
          title: 'Route Handlers',
          lessons: [
            lesson('next-rh-file', 'route.ts file'),
            lesson('next-rh-methods', 'GET / POST / PUT / DELETE / PATCH'),
            lesson('next-rh-request', 'NextRequest & NextResponse'),
            lesson('next-rh-headers', 'Headers & cookies'),
            lesson('next-rh-dynamic', 'Dynamic route handlers'),
            lesson('next-rh-edge', 'Edge runtime'),
          ],
        },
        {
          id: 'next-middleware',
          title: 'Middleware',
          lessons: [
            lesson('next-mw-file', 'middleware.ts at root'),
            lesson('next-mw-matcher', 'matcher config'),
            lesson('next-mw-response', 'NextResponse.next() / redirect() / rewrite()'),
            lesson('next-mw-headers', 'Request headers modification'),
            lesson('next-mw-cookies', 'Reading cookies in middleware'),
          ],
        },
        {
          id: 'next-cookies-headers',
          title: 'Cookies & Headers',
          lessons: [
            lesson('next-ck-read', 'cookies() from next/headers'),
            lesson('next-hd-read', 'headers() from next/headers'),
            lesson('next-ck-set', 'Setting cookies in server actions'),
            lesson('next-ck-response', 'Response cookies'),
          ],
        },
      ],
    },
    {
      id: 'next-optimization',
      title: 'Optimization',
      topics: [
        {
          id: 'next-image',
          title: 'next/image',
          lessons: [
            lesson('next-img-comp', '<Image> component'),
            lesson('next-img-size', 'width & height requirement'),
            lesson('next-img-priority', 'priority (LCP)'),
            lesson('next-img-placeholder', 'placeholder="blur"'),
            lesson('next-img-sizes', 'sizes attribute'),
            lesson('next-img-remote', 'Remote image config'),
          ],
        },
        {
          id: 'next-font',
          title: 'next/font',
          lessons: [
            lesson('next-font-google', 'google() import'),
            lesson('next-font-local', 'local() import'),
            lesson('next-font-vars', 'CSS variables for Tailwind'),
            lesson('next-font-display', 'Display strategies'),
          ],
        },
        {
          id: 'next-metadata',
          title: 'Metadata & SEO',
          lessons: [
            lesson('next-meta-static', 'Static metadata object'),
            lesson('next-meta-dynamic', 'Dynamic generateMetadata()'),
            lesson('next-meta-og', 'OpenGraph & twitter fields'),
            lesson('next-meta-sitemap', 'sitemap.ts & robots.ts'),
            lesson('next-meta-og-img', 'opengraph-image.tsx'),
          ],
        },
      ],
    },
    {
      id: 'next-auth-db',
      title: 'Auth & Database',
      topics: [
        {
          id: 'next-clerk',
          title: 'Clerk with Next.js',
          lessons: [
            lesson('next-clerk-mw', 'middleware.ts setup'),
            lesson('next-clerk-provider', 'ClerkProvider in layout'),
            lesson('next-clerk-components', '<SignIn> <SignUp> components'),
            lesson('next-clerk-client', 'useUser / useAuth (client)'),
            lesson('next-clerk-server', 'currentUser() & auth() (server)'),
            lesson('next-clerk-api', 'Protecting API routes'),
          ],
        },
        {
          id: 'next-prisma',
          title: 'Prisma with Next.js',
          lessons: [
            lesson('next-prisma-schema', 'Schema & migrate'),
            lesson('next-prisma-client', 'Singleton client pattern (global)'),
            lesson('next-prisma-queries', 'Queries in server components'),
            lesson('next-prisma-relations', 'Relations'),
            lesson('next-prisma-tx', 'Transactions'),
          ],
        },
      ],
    },
  ],
}

// ─── TAILWIND CSS ─────────────────────────────────────────────────────────────

const tailwind: CatalogDomain = {
  id: 'tailwind',
  title: 'Tailwind CSS',
  emoji: '🎨',
  description: "A utility-first CSS framework for rapidly building custom UIs without writing CSS files.",
  tags: ['Frontend', 'CSS', 'Styling'],
  categories: [
    {
      id: 'tw-core',
      title: 'Core Concepts',
      topics: [
        {
          id: 'tw-utility-first',
          title: 'Utility-First CSS',
          lessons: [
            lesson('tw-uf-concept', 'What utility-first means vs BEM/CSS Modules'),
            lesson('tw-uf-benefits', 'Benefits (co-location, no naming)'),
            lesson('tw-uf-vs-inline', 'Comparison to inline styles (constraints = design system)'),
          ],
        },
        {
          id: 'tw-config',
          title: 'Configuration',
          lessons: [
            lesson('tw-cfg-file', 'tailwind.config.js/ts structure'),
            lesson('tw-cfg-content', 'content paths (critical for purge)'),
            lesson('tw-cfg-extend', 'theme.extend vs theme override'),
            lesson('tw-cfg-plugins', 'Plugins array'),
          ],
        },
        {
          id: 'tw-responsive',
          title: 'Responsive Design',
          lessons: [
            lesson('tw-rsp-breakpoints', 'Breakpoints (sm md lg xl 2xl)'),
            lesson('tw-rsp-mobile-first', 'Mobile-first approach'),
            lesson('tw-rsp-arbitrary', 'Arbitrary breakpoints (min-[900px]:)'),
            lesson('tw-rsp-container-q', 'Container queries'),
          ],
        },
        {
          id: 'tw-dark-mode',
          title: 'Dark Mode',
          lessons: [
            lesson('tw-dark-variant', 'dark: variant'),
            lesson('tw-dark-class', 'class strategy (html.dark)'),
            lesson('tw-dark-media', 'media strategy'),
            lesson('tw-dark-toggle', 'Toggle implementation with JS'),
          ],
        },
        {
          id: 'tw-arbitrary',
          title: 'Arbitrary Values',
          lessons: [
            lesson('tw-arb-brackets', 'Square bracket syntax (w-[123px])'),
            lesson('tw-arb-props', 'Arbitrary properties ([background:red])'),
            lesson('tw-arb-css-vars', 'CSS variables with arbitrary values'),
          ],
        },
      ],
    },
    {
      id: 'tw-layout',
      title: 'Layout',
      topics: [
        {
          id: 'tw-flexbox',
          title: 'Flexbox',
          lessons: [
            lesson('tw-flex-enable', 'flex & inline-flex'),
            lesson('tw-flex-direction', 'flex-row & flex-col'),
            lesson('tw-flex-justify', 'justify-content (justify-start to justify-between)'),
            lesson('tw-flex-align', 'align-items (items-center)'),
            lesson('tw-flex-wrap', 'flex-wrap'),
            lesson('tw-flex-gap', 'gap-x & gap-y'),
            lesson('tw-flex-grow', 'flex-grow flex-shrink flex-basis'),
          ],
        },
        {
          id: 'tw-grid',
          title: 'Grid',
          lessons: [
            lesson('tw-grid-enable', 'grid & inline-grid'),
            lesson('tw-grid-cols', 'grid-cols-N'),
            lesson('tw-grid-rows', 'grid-rows-N'),
            lesson('tw-grid-span', 'col-span-N & row-span-N'),
            lesson('tw-grid-gap', 'gap'),
            lesson('tw-grid-place', 'place-items & place-content'),
          ],
        },
        {
          id: 'tw-position',
          title: 'Positioning',
          lessons: [
            lesson('tw-pos-types', 'static relative absolute fixed sticky'),
            lesson('tw-pos-inset', 'top/right/bottom/left & inset'),
            lesson('tw-pos-z', 'z-index (z-10 z-50)'),
          ],
        },
        {
          id: 'tw-box',
          title: 'Box Model',
          lessons: [
            lesson('tw-box-display', 'Display (block inline flex grid hidden)'),
            lesson('tw-box-overflow', 'Overflow (overflow-auto overflow-hidden)'),
            lesson('tw-box-opacity', 'Opacity'),
          ],
        },
      ],
    },
    {
      id: 'tw-typography',
      title: 'Typography & Colors',
      topics: [
        {
          id: 'tw-text',
          title: 'Text Utilities',
          lessons: [
            lesson('tw-text-size', 'font-size (text-xs to text-9xl)'),
            lesson('tw-text-weight', 'font-weight (font-light to font-black)'),
            lesson('tw-text-family', 'font-family (font-sans font-mono)'),
            lesson('tw-text-leading', 'line-height (leading-*)'),
            lesson('tw-text-tracking', 'letter-spacing (tracking-*)'),
            lesson('tw-text-align', 'text-align & text-transform'),
            lesson('tw-text-truncate', 'text-overflow (truncate) & whitespace-nowrap'),
          ],
        },
        {
          id: 'tw-colors',
          title: 'Color System',
          lessons: [
            lesson('tw-col-palette', 'Full color palette (slate, gray, red, blue…)'),
            lesson('tw-col-shades', 'Shades (50-950)'),
            lesson('tw-col-bg', 'bg-{color} & bg-opacity'),
            lesson('tw-col-text', 'text-{color}'),
            lesson('tw-col-border', 'border-{color}'),
            lesson('tw-col-modifier', 'Opacity modifier (text-black/50)'),
          ],
        },
        {
          id: 'tw-gradients',
          title: 'Gradients',
          lessons: [
            lesson('tw-grad-dir', 'bg-gradient-to-{dir}'),
            lesson('tw-grad-from', 'from- via- to-'),
            lesson('tw-grad-arbitrary', 'Arbitrary gradient values'),
          ],
        },
      ],
    },
    {
      id: 'tw-spacing',
      title: 'Spacing & Sizing',
      topics: [
        {
          id: 'tw-spacing-utils',
          title: 'Spacing',
          lessons: [
            lesson('tw-sp-padding', 'p-{N} px-{N} py-{N} pt/pr/pb/pl'),
            lesson('tw-sp-margin', 'm-{N} mx-{N} my-{N} mt/mr/mb/ml'),
            lesson('tw-sp-space', 'space-x-{N} space-y-{N}'),
            lesson('tw-sp-negative', 'Negative margins (-m-{N})'),
          ],
        },
        {
          id: 'tw-sizing-utils',
          title: 'Sizing',
          lessons: [
            lesson('tw-sz-wh', 'w-{N} h-{N}'),
            lesson('tw-sz-full', 'w-full h-full w-screen h-screen'),
            lesson('tw-sz-minmax', 'min-w min-h max-w max-h'),
            lesson('tw-sz-fit', 'w-fit h-fit w-auto'),
            lesson('tw-sz-aspect', 'aspect-ratio (aspect-square aspect-video)'),
            lesson('tw-sz-object', 'object-fit (object-cover)'),
          ],
        },
        {
          id: 'tw-borders',
          title: 'Borders & Rings',
          lessons: [
            lesson('tw-bor-border', 'border & border-{width}'),
            lesson('tw-bor-rounded', 'rounded (rounded-sm to rounded-full)'),
            lesson('tw-bor-ring', 'ring ring-{width} ring-{color}'),
            lesson('tw-bor-divide', 'divide-{x/y} utilities'),
            lesson('tw-bor-shadow', 'shadow-sm to shadow-2xl'),
          ],
        },
      ],
    },
    {
      id: 'tw-animation',
      title: 'Animation & Effects',
      topics: [
        {
          id: 'tw-transitions',
          title: 'Transitions',
          lessons: [
            lesson('tw-trans-enable', 'transition (all by default)'),
            lesson('tw-trans-property', 'transition-{property}'),
            lesson('tw-trans-duration', 'duration-{N}'),
            lesson('tw-trans-ease', 'ease-{timing}'),
            lesson('tw-trans-delay', 'delay-{N}'),
          ],
        },
        {
          id: 'tw-animations',
          title: 'Animations',
          lessons: [
            lesson('tw-anim-spin', 'animate-spin'),
            lesson('tw-anim-pulse', 'animate-pulse'),
            lesson('tw-anim-bounce', 'animate-bounce'),
            lesson('tw-anim-ping', 'animate-ping'),
            lesson('tw-anim-custom', 'Custom animations via config'),
          ],
        },
        {
          id: 'tw-transforms',
          title: 'Transforms',
          lessons: [
            lesson('tw-tf-scale', 'scale-{N} & hover:scale-105'),
            lesson('tw-tf-rotate', 'rotate-{N}'),
            lesson('tw-tf-translate', 'translate-x translate-y'),
          ],
        },
      ],
    },
  ],
}

// ─── VITE ─────────────────────────────────────────────────────────────────────

const vite: CatalogDomain = {
  id: 'vite',
  title: 'Vite',
  emoji: '⚡',
  description: "The next-generation frontend build tool — instant server start, lightning-fast HMR, and optimised production builds.",
  tags: ['Tooling', 'Build', 'Frontend'],
  categories: [
    {
      id: 'vite-start',
      title: 'Getting Started',
      topics: [
        {
          id: 'vite-why',
          title: 'Why Vite',
          lessons: [
            lesson('vite-why-esm', 'ESM-based dev server (no bundling in dev)'),
            lesson('vite-why-esbuild', 'esbuild pre-bundling'),
            lesson('vite-why-vs', 'Comparison to webpack & CRA'),
            lesson('vite-why-hmr', 'HMR speed advantage'),
          ],
        },
        {
          id: 'vite-setup',
          title: 'Setup',
          lessons: [
            lesson('vite-setup-create', 'create-vite'),
            lesson('vite-setup-templates', 'Available templates (vanilla, react, react-ts, vue, svelte)'),
            lesson('vite-setup-structure', 'Project structure walkthrough'),
            lesson('vite-setup-dev', 'vite command & dev server'),
          ],
        },
      ],
    },
    {
      id: 'vite-config',
      title: 'Configuration',
      topics: [
        {
          id: 'vite-config-file',
          title: 'vite.config.ts',
          lessons: [
            lesson('vite-cfg-define', 'defineConfig helper'),
            lesson('vite-cfg-ts', 'TypeScript support'),
            lesson('vite-cfg-mode', 'Conditional config (mode)'),
            lesson('vite-cfg-alias', 'resolve.alias (@ for src)'),
          ],
        },
        {
          id: 'vite-env',
          title: 'Environment Variables',
          lessons: [
            lesson('vite-env-files', '.env / .env.local / .env.[mode]'),
            lesson('vite-env-prefix', 'VITE_ prefix requirement'),
            lesson('vite-env-import', 'import.meta.env.*'),
            lesson('vite-env-types', 'Type declarations (env.d.ts)'),
          ],
        },
        {
          id: 'vite-plugins',
          title: 'Plugins',
          lessons: [
            lesson('vite-plug-react', '@vitejs/plugin-react (+ SWC variant)'),
            lesson('vite-plug-svgr', 'vite-plugin-svgr'),
            lesson('vite-plug-rollup', 'Rollup plugin compatibility'),
            lesson('vite-plug-write', 'Writing a simple plugin'),
          ],
        },
      ],
    },
    {
      id: 'vite-build',
      title: 'Build & Deploy',
      topics: [
        {
          id: 'vite-prod-build',
          title: 'Production Build',
          lessons: [
            lesson('vite-build-cmd', 'vite build'),
            lesson('vite-build-output', 'dist/ output'),
            lesson('vite-build-split', 'Code splitting (dynamic imports)'),
            lesson('vite-build-chunks', 'Chunk size warnings & manualChunks'),
          ],
        },
        {
          id: 'vite-library',
          title: 'Library Mode',
          lessons: [
            lesson('vite-lib-config', 'lib config'),
            lesson('vite-lib-formats', 'Output formats (es, cjs, umd)'),
            lesson('vite-lib-external', 'Externalising dependencies'),
          ],
        },
      ],
    },
  ],
}

// ─── CLAUDE (ANTHROPIC) ───────────────────────────────────────────────────────

const claude: CatalogDomain = {
  id: 'claude-ai',
  title: 'Claude (Anthropic)',
  emoji: '🤖',
  description: "Anthropic's AI assistant family — from the API to Claude Code — for developers and power users.",
  tags: ['AI Tools', 'LLM', 'API'],
  categories: [
    {
      id: 'claude-understanding',
      title: 'Understanding Claude',
      topics: [
        {
          id: 'claude-models',
          title: 'Model Family',
          lessons: [
            lesson('claude-mod-haiku', 'Claude Haiku (speed-optimised, cheapest)'),
            lesson('claude-mod-sonnet', 'Claude Sonnet (balanced capability + cost)'),
            lesson('claude-mod-opus', 'Claude Opus (most capable, highest cost)'),
            lesson('claude-mod-versions', 'Model versioning & IDs'),
            lesson('claude-mod-choose', 'Choosing the right model'),
          ],
        },
        {
          id: 'claude-context',
          title: 'Context Window',
          lessons: [
            lesson('claude-ctx-what', 'What a context window is'),
            lesson('claude-ctx-tokens', 'Tokens vs words'),
            lesson('claude-ctx-cost', 'How context affects cost'),
            lesson('claude-ctx-manage', 'Managing long conversations'),
          ],
        },
        {
          id: 'claude-capabilities',
          title: 'Capabilities & Limitations',
          lessons: [
            lesson('claude-cap-strengths', 'What Claude excels at'),
            lesson('claude-cap-cutoff', 'Knowledge cutoff'),
            lesson('claude-cap-halluc', 'Hallucinations (confident errors)'),
            lesson('claude-cap-refusal', 'Refusal patterns'),
            lesson('claude-cap-limits', 'Rate limits & throughput'),
          ],
        },
      ],
    },
    {
      id: 'claude-prompting',
      title: 'Prompt Engineering',
      topics: [
        {
          id: 'claude-prompt-structure',
          title: 'Prompt Structure',
          lessons: [
            lesson('claude-ps-task', 'Clear task description'),
            lesson('claude-ps-context', 'Providing context'),
            lesson('claude-ps-role', 'Role/persona instructions'),
            lesson('claude-ps-format', 'Output format specification'),
            lesson('claude-ps-order', 'Putting instructions before content'),
          ],
        },
        {
          id: 'claude-fewshot',
          title: 'Few-Shot Prompting',
          lessons: [
            lesson('claude-fs-zero', 'Zero-shot vs few-shot'),
            lesson('claude-fs-format', 'Formatting examples consistently'),
            lesson('claude-fs-when', 'When examples help vs hurt'),
          ],
        },
        {
          id: 'claude-cot',
          title: 'Chain-of-Thought',
          lessons: [
            lesson('claude-cot-basic', '"Let me think step by step"'),
            lesson('claude-cot-explicit', 'Explicit reasoning requests'),
            lesson('claude-cot-extended', 'Extended thinking mode'),
          ],
        },
        {
          id: 'claude-xml',
          title: 'XML Tags for Structure',
          lessons: [
            lesson('claude-xml-tags', 'Using <document> <instructions> <example> tags'),
            lesson('claude-xml-why', 'Why XML helps parse complex prompts'),
            lesson('claude-xml-output', 'Requesting structured output'),
          ],
        },
        {
          id: 'claude-system',
          title: 'System Prompts',
          lessons: [
            lesson('claude-sys-vs-human', 'System vs human turn'),
            lesson('claude-sys-what', 'What to put in system prompt'),
            lesson('claude-sys-persona', 'Persona definition'),
            lesson('claude-sys-constraints', 'Constraints & guardrails'),
          ],
        },
      ],
    },
    {
      id: 'claude-api',
      title: 'Anthropic API',
      topics: [
        {
          id: 'claude-api-basics',
          title: 'API Basics',
          lessons: [
            lesson('claude-api-key', 'API key setup & environment variables'),
            lesson('claude-api-sdk', 'SDK installation (@anthropic-ai/sdk)'),
            lesson('claude-api-request', 'Basic request (model, messages, max_tokens)'),
            lesson('claude-api-response', 'Response structure (content blocks)'),
            lesson('claude-api-errors', 'Error handling'),
          ],
        },
        {
          id: 'claude-streaming',
          title: 'Streaming',
          lessons: [
            lesson('claude-str-enable', 'stream: true'),
            lesson('claude-str-events', 'Text delta events'),
            lesson('claude-str-nodejs', 'Handling stream in Node.js'),
            lesson('claude-str-error', 'Stream error handling'),
          ],
        },
        {
          id: 'claude-vision',
          title: 'Vision',
          lessons: [
            lesson('claude-vis-base64', 'Passing images (base64)'),
            lesson('claude-vis-url', 'Passing images (URL)'),
            lesson('claude-vis-limits', 'Image size limits'),
            lesson('claude-vis-multi', 'Multi-image requests'),
          ],
        },
        {
          id: 'claude-tools',
          title: 'Tool Use (Function Calling)',
          lessons: [
            lesson('claude-tool-define', 'Defining tools (name, description, input_schema)'),
            lesson('claude-tool-flow', 'Tool use flow (model requests → you execute → return result)'),
            lesson('claude-tool-parallel', 'Parallel tool calls'),
            lesson('claude-tool-force', 'Tool choice forcing'),
          ],
        },
        {
          id: 'claude-caching',
          title: 'Prompt Caching',
          lessons: [
            lesson('claude-cache-control', 'Cache control headers'),
            lesson('claude-cache-blocks', 'Cacheable prompt blocks'),
            lesson('claude-cache-ttl', 'Cache TTL (5 min)'),
            lesson('claude-cache-savings', 'Cost savings calculation'),
          ],
        },
      ],
    },
    {
      id: 'claude-code-tool',
      title: 'Claude Code',
      topics: [
        {
          id: 'claude-code-setup',
          title: 'Setup',
          lessons: [
            lesson('claude-cc-install', 'Installation (npm i -g @anthropic-ai/claude-code)'),
            lesson('claude-cc-auth', 'Authentication (claude login)'),
            lesson('claude-cc-first', 'First session'),
          ],
        },
        {
          id: 'claude-code-commands',
          title: 'Core Commands',
          lessons: [
            lesson('claude-cc-clear', '/clear & /help'),
            lesson('claude-cc-memory', '/memory'),
            lesson('claude-cc-cost', '/cost'),
            lesson('claude-cc-compact', '/compact'),
          ],
        },
        {
          id: 'claude-code-claudemd',
          title: 'CLAUDE.md',
          lessons: [
            lesson('claude-cc-project-md', 'Project-level instructions'),
            lesson('claude-cc-user-md', 'User-level instructions (~/.claude/CLAUDE.md)'),
            lesson('claude-cc-what', 'What to put in CLAUDE.md'),
          ],
        },
        {
          id: 'claude-code-mcp',
          title: 'MCP Servers',
          lessons: [
            lesson('claude-cc-mcp-what', 'What MCP is'),
            lesson('claude-cc-mcp-add', 'Adding MCP servers (claude mcp add)'),
            lesson('claude-cc-mcp-builtin', 'Built-in servers (filesystem, GitHub)'),
            lesson('claude-cc-mcp-write', 'Writing a simple MCP server'),
          ],
        },
      ],
    },
  ],
}

// ─── CHATGPT / OPENAI ────────────────────────────────────────────────────────

const chatgpt: CatalogDomain = {
  id: 'chatgpt',
  title: 'ChatGPT / OpenAI',
  emoji: '🧠',
  description: "OpenAI's ChatGPT and API — GPT-4o, o1 reasoning models, function calling, and the Assistants API.",
  tags: ['AI Tools', 'LLM', 'API'],
  categories: [
    {
      id: 'chatgpt-understanding',
      title: 'Understanding ChatGPT',
      topics: [
        {
          id: 'chatgpt-models',
          title: 'Model Family',
          lessons: [
            lesson('chatgpt-mod-4o', 'GPT-4o (default, multimodal)'),
            lesson('chatgpt-mod-mini', 'GPT-4o-mini (fast, cheap)'),
            lesson('chatgpt-mod-o1', 'o1 (slow reasoning)'),
            lesson('chatgpt-mod-o3', 'o3 & o4-mini (strongest reasoning)'),
            lesson('chatgpt-mod-choose', 'When to use which'),
          ],
        },
        {
          id: 'chatgpt-features',
          title: 'ChatGPT Features',
          lessons: [
            lesson('chatgpt-feat-search', 'Web search'),
            lesson('chatgpt-feat-code', 'Code Interpreter (Python execution)'),
            lesson('chatgpt-feat-dalle', 'DALL-E image generation'),
            lesson('chatgpt-feat-files', 'File uploads (PDF, CSV)'),
            lesson('chatgpt-feat-memory', 'Memory & custom instructions'),
            lesson('chatgpt-feat-gpts', 'Custom GPTs'),
          ],
        },
      ],
    },
    {
      id: 'chatgpt-prompting',
      title: 'Prompt Engineering',
      topics: [
        {
          id: 'chatgpt-effective',
          title: 'Effective Prompting',
          lessons: [
            lesson('chatgpt-pr-specific', 'Be specific'),
            lesson('chatgpt-pr-context', 'Provide context'),
            lesson('chatgpt-pr-format', 'Specify format'),
            lesson('chatgpt-pr-examples', 'Give examples'),
            lesson('chatgpt-pr-iterate', 'Iterate on outputs'),
          ],
        },
        {
          id: 'chatgpt-reasoning',
          title: 'Reasoning Models (o1/o3)',
          lessons: [
            lesson('chatgpt-rsn-concise', "Concise system prompts (don't over-explain)"),
            lesson('chatgpt-rsn-no-cot', 'No chain-of-thought forcing'),
            lesson('chatgpt-rsn-complex', 'Longer responses for complex tasks'),
          ],
        },
        {
          id: 'chatgpt-structured',
          title: 'Structured Outputs',
          lessons: [
            lesson('chatgpt-so-json', 'JSON mode'),
            lesson('chatgpt-so-schema', 'Schema enforcement'),
            lesson('chatgpt-so-parse', 'Parsing reliably'),
          ],
        },
      ],
    },
    {
      id: 'chatgpt-api',
      title: 'OpenAI API',
      topics: [
        {
          id: 'chatgpt-completions',
          title: 'Chat Completions',
          lessons: [
            lesson('chatgpt-api-basics', 'API basics & SDK setup'),
            lesson('chatgpt-api-messages', 'system/user/assistant messages'),
            lesson('chatgpt-api-params', 'temperature, max_tokens, top_p'),
            lesson('chatgpt-api-penalties', 'presence_penalty & frequency_penalty'),
            lesson('chatgpt-api-streaming', 'Streaming responses'),
          ],
        },
        {
          id: 'chatgpt-functions',
          title: 'Function Calling',
          lessons: [
            lesson('chatgpt-fn-define', 'tools array (name, description, parameters JSON schema)'),
            lesson('chatgpt-fn-choice', 'Tool choice (auto, required, specific)'),
            lesson('chatgpt-fn-execute', 'Executing the function'),
            lesson('chatgpt-fn-return', 'Returning results'),
            lesson('chatgpt-fn-parallel', 'Parallel calls'),
          ],
        },
        {
          id: 'chatgpt-vision',
          title: 'Vision',
          lessons: [
            lesson('chatgpt-vis-url', 'Image URL'),
            lesson('chatgpt-vis-base64', 'Base64 images'),
            lesson('chatgpt-vis-detail', 'detail parameter (low/high/auto)'),
          ],
        },
        {
          id: 'chatgpt-assistants',
          title: 'Assistants API',
          lessons: [
            lesson('chatgpt-asst-threads', 'Threads concept'),
            lesson('chatgpt-asst-create', 'Creating assistants'),
            lesson('chatgpt-asst-run', 'Running & polling for completion'),
            lesson('chatgpt-asst-tools', 'File search & code interpreter tools'),
          ],
        },
        {
          id: 'chatgpt-embeddings',
          title: 'Embeddings',
          lessons: [
            lesson('chatgpt-emb-models', 'text-embedding-3-small vs large'),
            lesson('chatgpt-emb-usecases', 'Use cases (semantic search, RAG)'),
            lesson('chatgpt-emb-cosine', 'Cosine similarity'),
          ],
        },
      ],
    },
  ],
}

// ─── GITHUB COPILOT ───────────────────────────────────────────────────────────

const githubCopilot: CatalogDomain = {
  id: 'github-copilot',
  title: 'GitHub Copilot',
  emoji: '🐙',
  description: "AI pair programmer in your IDE — inline completions, Copilot Chat, and workspace-aware code generation.",
  tags: ['AI Tools', 'Developer Tools', 'IDE'],
  categories: [
    {
      id: 'copilot-setup',
      title: 'Setup & Interface',
      topics: [
        {
          id: 'copilot-install',
          title: 'Installation',
          lessons: [
            lesson('cop-inst-vscode', 'VS Code extension'),
            lesson('cop-inst-jb', 'JetBrains plugin'),
            lesson('cop-inst-sub', 'GitHub Copilot subscription (individual/business)'),
            lesson('cop-inst-enable', 'Enabling & disabling in settings'),
          ],
        },
        {
          id: 'copilot-inline',
          title: 'Inline Completions',
          lessons: [
            lesson('cop-inline-accept', 'Tab to accept'),
            lesson('cop-inline-partial', 'Ctrl+→ partial word accept'),
            lesson('cop-inline-cycle', 'Alt+] next suggestion'),
            lesson('cop-inline-dismiss', 'Esc to dismiss'),
          ],
        },
        {
          id: 'copilot-chat-panel',
          title: 'Copilot Chat (IDE)',
          lessons: [
            lesson('cop-chat-open', 'Open Copilot Chat panel'),
            lesson('cop-chat-ask', 'Ask questions about code'),
            lesson('cop-chat-select', 'Select code then ask'),
            lesson('cop-chat-history', 'Chat history'),
          ],
        },
      ],
    },
    {
      id: 'copilot-commands',
      title: 'Slash Commands & Context',
      topics: [
        {
          id: 'copilot-explain',
          title: '/explain',
          lessons: [
            lesson('cop-exp-code', 'Explaining selected code'),
            lesson('cop-exp-errors', 'Explaining error messages'),
            lesson('cop-exp-unfamiliar', 'Understanding unfamiliar codebases'),
          ],
        },
        {
          id: 'copilot-fix',
          title: '/fix',
          lessons: [
            lesson('cop-fix-auto', 'Auto-fix errors'),
            lesson('cop-fix-selected', 'Fix selected code'),
            lesson('cop-fix-review', 'Review suggested fix before accepting'),
          ],
        },
        {
          id: 'copilot-tests',
          title: '/tests',
          lessons: [
            lesson('cop-test-generate', 'Generate unit tests for selected function'),
            lesson('cop-test-framework', 'Choosing test framework'),
            lesson('cop-test-refine', 'Refining generated tests'),
          ],
        },
        {
          id: 'copilot-workspace',
          title: '@workspace & #file',
          lessons: [
            lesson('cop-ws-index', '@workspace: index codebase'),
            lesson('cop-ws-cross', 'Ask cross-file questions'),
            lesson('cop-ws-limits', 'Limitations of workspace context'),
            lesson('cop-file-pin', '#file references (pin a file to context)'),
          ],
        },
        {
          id: 'copilot-inline-chat',
          title: 'Inline Chat (Ctrl+I)',
          lessons: [
            lesson('cop-ic-open', 'Ctrl+I for inline'),
            lesson('cop-ic-edit', 'Editing selected code'),
            lesson('cop-ic-generate', 'Generating from comment'),
            lesson('cop-ic-diff', 'Diff view & acceptance'),
          ],
        },
      ],
    },
    {
      id: 'copilot-best-practices',
      title: 'Best Practices',
      topics: [
        {
          id: 'copilot-context-tips',
          title: 'Good Context = Good Suggestions',
          lessons: [
            lesson('cop-bp-comments', 'Comment-driven development'),
            lesson('cop-bp-naming', 'Function name clarity'),
            lesson('cop-bp-types', 'Type hints & signatures'),
          ],
        },
        {
          id: 'copilot-verify',
          title: 'Verification Mindset',
          lessons: [
            lesson('cop-ver-trust', 'When to trust suggestions'),
            lesson('cop-ver-verify', 'When to verify carefully'),
            lesson('cop-ver-security', 'Security-sensitive code caution'),
            lesson('cop-ver-hallucinated', 'Hallucinated APIs'),
          ],
        },
        {
          id: 'copilot-patterns',
          title: 'Prompt Patterns',
          lessons: [
            lesson('cop-pp-write', '"Write a function that…"'),
            lesson('cop-pp-refactor', '"Refactor this to use…"'),
            lesson('cop-pp-error', '"Add error handling for…"'),
            lesson('cop-pp-ts', '"Convert to TypeScript"'),
          ],
        },
      ],
    },
  ],
}

// ─── CATALOG EXPORT ───────────────────────────────────────────────────────────

// ─── GIT ──────────────────────────────────────────────────────────────────────

const git: CatalogDomain = {
  id: 'git',
  title: 'Git',
  emoji: '🌿',
  description: "The version control system every developer needs — from first commit to collaborative workflows and CI/CD.",
  tags: ['Tooling', 'DevOps', 'Fundamentals'],
  categories: [
    {
      id: 'git-basics',
      title: 'Basics',
      topics: [
        {
          id: 'git-setup',
          title: 'Setup',
          lessons: [
            lesson('git-setup-install', 'Installing Git'),
            lesson('git-setup-config', 'git config (name, email, editor)'),
            lesson('git-setup-init', 'git init — creating a repo'),
            lesson('git-setup-clone', 'git clone'),
          ],
        },
        {
          id: 'git-core-workflow',
          title: 'Core Workflow',
          lessons: [
            lesson('git-wf-status', 'git status'),
            lesson('git-wf-add', 'git add (staging)'),
            lesson('git-wf-commit', 'git commit -m'),
            lesson('git-wf-log', 'git log & git log --oneline'),
            lesson('git-wf-diff', 'git diff (unstaged vs staged)'),
          ],
        },
        {
          id: 'git-ignoring',
          title: '.gitignore',
          lessons: [
            lesson('git-ignore-syntax', '.gitignore syntax & patterns'),
            lesson('git-ignore-global', 'Global .gitignore'),
            lesson('git-ignore-templates', 'gitignore.io templates'),
          ],
        },
      ],
    },
    {
      id: 'git-branching',
      title: 'Branching',
      topics: [
        {
          id: 'git-branches',
          title: 'Branches',
          lessons: [
            lesson('git-br-create', 'git branch & git switch -c'),
            lesson('git-br-list', 'Listing & deleting branches'),
            lesson('git-br-rename', 'Renaming branches'),
            lesson('git-br-main', 'main vs master convention'),
          ],
        },
        {
          id: 'git-merge',
          title: 'Merging',
          lessons: [
            lesson('git-merge-fast', 'Fast-forward merge'),
            lesson('git-merge-3way', 'Three-way merge'),
            lesson('git-merge-conflict', 'Resolving merge conflicts'),
            lesson('git-merge-abort', 'git merge --abort'),
          ],
        },
        {
          id: 'git-rebase',
          title: 'Rebasing',
          lessons: [
            lesson('git-rebase-basic', 'git rebase basics'),
            lesson('git-rebase-interactive', 'Interactive rebase (squash, fixup, reword)'),
            lesson('git-rebase-vs-merge', 'Rebase vs merge trade-offs'),
            lesson('git-rebase-abort', 'git rebase --abort'),
          ],
        },
      ],
    },
    {
      id: 'git-remote',
      title: 'Remote Repositories',
      topics: [
        {
          id: 'git-remote-basics',
          title: 'Remotes',
          lessons: [
            lesson('git-rem-add', 'git remote add origin'),
            lesson('git-rem-fetch', 'git fetch vs git pull'),
            lesson('git-rem-push', 'git push & git push -u'),
            lesson('git-rem-track', 'Tracking branches'),
          ],
        },
        {
          id: 'git-github',
          title: 'GitHub Workflow',
          lessons: [
            lesson('git-gh-fork', 'Forking a repository'),
            lesson('git-gh-pr', 'Opening a Pull Request'),
            lesson('git-gh-review', 'Code review in PRs'),
            lesson('git-gh-merge', 'Merging a PR (squash, rebase, merge commit)'),
          ],
        },
      ],
    },
    {
      id: 'git-undoing',
      title: 'Undoing Changes',
      topics: [
        {
          id: 'git-undo',
          title: 'Undo Commands',
          lessons: [
            lesson('git-undo-restore', 'git restore (discard working dir changes)'),
            lesson('git-undo-reset-soft', 'git reset --soft (undo commit, keep staged)'),
            lesson('git-undo-reset-hard', 'git reset --hard (danger: discard all)'),
            lesson('git-undo-revert', 'git revert (safe undo for shared history)'),
            lesson('git-undo-stash', 'git stash & git stash pop'),
          ],
        },
        {
          id: 'git-advanced',
          title: 'Advanced',
          lessons: [
            lesson('git-adv-cherry', 'git cherry-pick'),
            lesson('git-adv-tag', 'git tag (annotated & lightweight)'),
            lesson('git-adv-bisect', 'git bisect (binary search for bugs)'),
            lesson('git-adv-reflog', 'git reflog (recovering lost commits)'),
          ],
        },
      ],
    },
  ],
}

// ─── TYPESCRIPT ───────────────────────────────────────────────────────────────

const typescript: CatalogDomain = {
  id: 'typescript',
  title: 'TypeScript',
  emoji: '🔷',
  description: "JavaScript with static types — catch errors at compile time, improve IDE support, and write self-documenting code.",
  tags: ['Language', 'Frontend', 'Backend'],
  categories: [
    {
      id: 'ts-basics',
      title: 'Basics',
      topics: [
        {
          id: 'ts-setup',
          title: 'Setup',
          lessons: [
            lesson('ts-setup-install', 'Installing TypeScript (tsc)'),
            lesson('ts-setup-tsconfig', 'tsconfig.json basics'),
            lesson('ts-setup-strict', 'strict mode — why enable it'),
            lesson('ts-setup-compile', 'Compiling .ts files'),
          ],
        },
        {
          id: 'ts-primitive-types',
          title: 'Primitive Types',
          lessons: [
            lesson('ts-prim-string', 'string, number, boolean'),
            lesson('ts-prim-null', 'null & undefined'),
            lesson('ts-prim-any', 'any — why to avoid it'),
            lesson('ts-prim-unknown', 'unknown — safer alternative to any'),
            lesson('ts-prim-never', 'never — unreachable code'),
            lesson('ts-prim-void', 'void — functions that return nothing'),
          ],
        },
        {
          id: 'ts-literal-union',
          title: 'Literal & Union Types',
          lessons: [
            lesson('ts-lit-literal', 'Literal types ("left" | "right")'),
            lesson('ts-lit-union', 'Union types (string | number)'),
            lesson('ts-lit-intersection', 'Intersection types (A & B)'),
            lesson('ts-lit-narrowing', 'Type narrowing (typeof, instanceof, in)'),
          ],
        },
      ],
    },
    {
      id: 'ts-interfaces',
      title: 'Interfaces & Types',
      topics: [
        {
          id: 'ts-interface',
          title: 'Interfaces',
          lessons: [
            lesson('ts-iface-define', 'interface definition'),
            lesson('ts-iface-optional', 'Optional properties (?)'),
            lesson('ts-iface-readonly', 'readonly properties'),
            lesson('ts-iface-extend', 'Extending interfaces'),
            lesson('ts-iface-implement', 'Implementing interfaces in classes'),
          ],
        },
        {
          id: 'ts-type-alias',
          title: 'Type Aliases',
          lessons: [
            lesson('ts-type-define', 'type alias definition'),
            lesson('ts-type-vs-interface', 'type vs interface — when to use each'),
            lesson('ts-type-complex', 'Complex type aliases'),
          ],
        },
        {
          id: 'ts-functions-typed',
          title: 'Typed Functions',
          lessons: [
            lesson('ts-fn-params', 'Typed parameters & return types'),
            lesson('ts-fn-optional', 'Optional & default parameters'),
            lesson('ts-fn-overloads', 'Function overloads'),
            lesson('ts-fn-signature', 'Function type signatures'),
          ],
        },
        {
          id: 'ts-arrays-tuples',
          title: 'Arrays & Tuples',
          lessons: [
            lesson('ts-arr-typed', 'Typed arrays (string[], Array<string>)'),
            lesson('ts-arr-tuples', 'Tuples ([string, number])'),
            lesson('ts-arr-readonly', 'readonly arrays'),
          ],
        },
      ],
    },
    {
      id: 'ts-generics',
      title: 'Generics',
      topics: [
        {
          id: 'ts-generics-basics',
          title: 'Generic Basics',
          lessons: [
            lesson('ts-gen-function', 'Generic functions <T>'),
            lesson('ts-gen-interface', 'Generic interfaces & types'),
            lesson('ts-gen-constraints', 'Constraints (<T extends string>)'),
            lesson('ts-gen-default', 'Default type parameters'),
          ],
        },
        {
          id: 'ts-utility-types',
          title: 'Utility Types',
          lessons: [
            lesson('ts-util-partial', 'Partial<T>'),
            lesson('ts-util-required', 'Required<T>'),
            lesson('ts-util-pick', 'Pick<T, K>'),
            lesson('ts-util-omit', 'Omit<T, K>'),
            lesson('ts-util-record', 'Record<K, V>'),
            lesson('ts-util-exclude', 'Exclude<T, U> & Extract<T, U>'),
            lesson('ts-util-returntype', 'ReturnType<T> & Parameters<T>'),
            lesson('ts-util-awaited', 'Awaited<T>'),
          ],
        },
      ],
    },
    {
      id: 'ts-advanced',
      title: 'Advanced Types',
      topics: [
        {
          id: 'ts-mapped',
          title: 'Mapped & Conditional Types',
          lessons: [
            lesson('ts-map-mapped', 'Mapped types ({ [K in keyof T]: ... })'),
            lesson('ts-map-conditional', 'Conditional types (T extends U ? X : Y)'),
            lesson('ts-map-infer', 'infer keyword'),
            lesson('ts-map-template', 'Template literal types'),
          ],
        },
        {
          id: 'ts-discriminated',
          title: 'Discriminated Unions',
          lessons: [
            lesson('ts-disc-pattern', 'Discriminated union pattern'),
            lesson('ts-disc-exhaustive', 'Exhaustive checking with never'),
            lesson('ts-disc-narrowing', 'Narrowing with switch'),
          ],
        },
        {
          id: 'ts-react-types',
          title: 'TypeScript with React',
          lessons: [
            lesson('ts-react-fc', 'FC & ReactNode types'),
            lesson('ts-react-events', 'Event types (MouseEvent, ChangeEvent)'),
            lesson('ts-react-useref', 'useRef typing'),
            lesson('ts-react-usereducer', 'useReducer action typing'),
            lesson('ts-react-generic', 'Generic components'),
          ],
        },
      ],
    },
  ],
}

// ─── PYTHON ───────────────────────────────────────────────────────────────────

const python: CatalogDomain = {
  id: 'python',
  title: 'Python',
  emoji: '🐍',
  description: "The language of AI, data science, and rapid scripting — readable, powerful, and everywhere.",
  tags: ['Language', 'AI/ML', 'Backend', 'Scripting'],
  categories: [
    {
      id: 'py-fundamentals',
      title: 'Fundamentals',
      topics: [
        {
          id: 'py-setup',
          title: 'Setup',
          lessons: [
            lesson('py-setup-install', 'Installing Python 3'),
            lesson('py-setup-venv', 'Virtual environments (venv)'),
            lesson('py-setup-pip', 'pip install & requirements.txt'),
            lesson('py-setup-repl', 'Python REPL & running scripts'),
          ],
        },
        {
          id: 'py-basics',
          title: 'Variables & Types',
          lessons: [
            lesson('py-bas-int', 'int & float'),
            lesson('py-bas-str', 'str'),
            lesson('py-bas-bool', 'bool & None'),
            lesson('py-bas-print', 'print() & input()'),
            lesson('py-bas-type', 'type() & isinstance()'),
          ],
        },
        {
          id: 'py-operators',
          title: 'Operators',
          lessons: [
            lesson('py-op-arith', 'Arithmetic (** for power, // floor div)'),
            lesson('py-op-compare', 'Comparison operators'),
            lesson('py-op-logical', 'Logical (and, or, not)'),
            lesson('py-op-identity', 'Identity (is, is not)'),
            lesson('py-op-membership', 'Membership (in, not in)'),
          ],
        },
        {
          id: 'py-strings',
          title: 'Strings',
          lessons: [
            lesson('py-str-fstring', 'f-strings (f"Hello {name}")'),
            lesson('py-str-methods', 'String methods (upper, lower, strip, split, join, replace)'),
            lesson('py-str-slicing', 'Slicing (s[1:4], s[::-1])'),
            lesson('py-str-format', '.format() & % formatting'),
          ],
        },
        {
          id: 'py-conditionals',
          title: 'Conditionals',
          lessons: [
            lesson('py-cond-if', 'if-elif-else'),
            lesson('py-cond-ternary', 'Ternary (x if cond else y)'),
            lesson('py-cond-match', 'match-case (Python 3.10+)'),
          ],
        },
        {
          id: 'py-loops',
          title: 'Loops',
          lessons: [
            lesson('py-loop-for', 'for loop'),
            lesson('py-loop-while', 'while loop'),
            lesson('py-loop-range', 'range()'),
            lesson('py-loop-enumerate', 'enumerate()'),
            lesson('py-loop-zip', 'zip()'),
            lesson('py-loop-break', 'break & continue'),
          ],
        },
        {
          id: 'py-functions',
          title: 'Functions',
          lessons: [
            lesson('py-fn-def', 'def & return'),
            lesson('py-fn-args', '*args & **kwargs'),
            lesson('py-fn-default', 'Default parameters'),
            lesson('py-fn-lambda', 'lambda expressions'),
            lesson('py-fn-docstring', 'Docstrings'),
          ],
        },
      ],
    },
    {
      id: 'py-data-structures',
      title: 'Data Structures',
      topics: [
        {
          id: 'py-list',
          title: 'Lists',
          lessons: [
            lesson('py-list-basics', 'List basics (create, index, slice)'),
            lesson('py-list-methods', 'append() extend() insert() remove() pop() sort()'),
            lesson('py-list-comprehension', 'List comprehensions [x*2 for x in lst]'),
            lesson('py-list-nested', 'Nested lists'),
          ],
        },
        {
          id: 'py-dict',
          title: 'Dictionaries',
          lessons: [
            lesson('py-dict-basics', 'dict basics (create, access, update)'),
            lesson('py-dict-methods', 'keys() values() items() get() pop() update()'),
            lesson('py-dict-comprehension', 'Dict comprehensions {k: v for k, v in ...}'),
            lesson('py-dict-defaultdict', 'defaultdict & Counter'),
          ],
        },
        {
          id: 'py-set-tuple',
          title: 'Sets & Tuples',
          lessons: [
            lesson('py-set-basics', 'set basics (add, remove, union, intersection)'),
            lesson('py-tuple-basics', 'tuple basics & immutability'),
            lesson('py-tuple-unpack', 'Tuple unpacking & named tuples'),
          ],
        },
        {
          id: 'py-comprehensions',
          title: 'Comprehensions & Generators',
          lessons: [
            lesson('py-comp-list', 'List comprehensions with conditions'),
            lesson('py-comp-gen', 'Generator expressions (memory efficient)'),
            lesson('py-comp-gen-fn', 'Generator functions (yield)'),
          ],
        },
      ],
    },
    {
      id: 'py-oop',
      title: 'OOP',
      topics: [
        {
          id: 'py-classes',
          title: 'Classes',
          lessons: [
            lesson('py-cls-define', 'class & __init__'),
            lesson('py-cls-self', 'self & instance attributes'),
            lesson('py-cls-methods', 'Instance, class (@classmethod), and static methods'),
            lesson('py-cls-properties', '@property (getter/setter)'),
          ],
        },
        {
          id: 'py-inheritance',
          title: 'Inheritance',
          lessons: [
            lesson('py-inh-basic', 'Inheritance & super()'),
            lesson('py-inh-mro', 'MRO & multiple inheritance'),
            lesson('py-inh-abstract', 'Abstract classes (ABC)'),
          ],
        },
        {
          id: 'py-dunder',
          title: 'Dunder Methods',
          lessons: [
            lesson('py-dunder-str', '__str__ & __repr__'),
            lesson('py-dunder-eq', '__eq__ & __hash__'),
            lesson('py-dunder-iter', '__iter__ & __next__'),
            lesson('py-dunder-context', '__enter__ & __exit__ (context managers)'),
          ],
        },
        {
          id: 'py-dataclasses',
          title: 'Dataclasses',
          lessons: [
            lesson('py-dc-basic', '@dataclass decorator'),
            lesson('py-dc-defaults', 'field() & defaults'),
            lesson('py-dc-frozen', 'frozen=True (immutable)'),
          ],
        },
      ],
    },
    {
      id: 'py-stdlib',
      title: 'Standard Library & Ecosystem',
      topics: [
        {
          id: 'py-fileio',
          title: 'File I/O',
          lessons: [
            lesson('py-file-open', 'open() & context manager (with)'),
            lesson('py-file-read', 'Reading files (read, readlines, readline)'),
            lesson('py-file-write', 'Writing files'),
            lesson('py-file-pathlib', 'pathlib.Path'),
            lesson('py-file-json', 'json.load() & json.dump()'),
          ],
        },
        {
          id: 'py-exceptions',
          title: 'Exception Handling',
          lessons: [
            lesson('py-exc-try', 'try / except / else / finally'),
            lesson('py-exc-types', 'Built-in exception types'),
            lesson('py-exc-custom', 'Custom exceptions (class MyError(Exception))'),
            lesson('py-exc-raise', 'raise & raise from'),
          ],
        },
        {
          id: 'py-stdlib-modules',
          title: 'Useful Standard Library',
          lessons: [
            lesson('py-std-os', 'os & sys (env, args, paths)'),
            lesson('py-std-datetime', 'datetime & timedelta'),
            lesson('py-std-collections', 'collections (Counter, defaultdict, deque, namedtuple)'),
            lesson('py-std-itertools', 'itertools (chain, product, combinations)'),
            lesson('py-std-functools', 'functools (partial, lru_cache, reduce)'),
            lesson('py-std-re', 're (regex)'),
          ],
        },
        {
          id: 'py-type-hints',
          title: 'Type Hints',
          lessons: [
            lesson('py-types-basic', 'Basic annotations (x: int, def f() -> str)'),
            lesson('py-types-typing', 'typing module (List, Dict, Optional, Union, Any)'),
            lesson('py-types-modern', 'Modern syntax (Python 3.10+ — X | Y, list[int])'),
            lesson('py-types-mypy', 'mypy for static type checking'),
          ],
        },
      ],
    },
    {
      id: 'py-async',
      title: 'Async Python',
      topics: [
        {
          id: 'py-asyncio',
          title: 'asyncio',
          lessons: [
            lesson('py-async-syntax', 'async def & await'),
            lesson('py-async-run', 'asyncio.run()'),
            lesson('py-async-gather', 'asyncio.gather() (parallel tasks)'),
            lesson('py-async-task', 'asyncio.create_task()'),
            lesson('py-async-aiohttp', 'aiohttp for async HTTP'),
          ],
        },
      ],
    },
  ],
}

// ─── NODE.JS / EXPRESS ────────────────────────────────────────────────────────

const nodejs: CatalogDomain = {
  id: 'nodejs',
  title: 'Node.js / Express',
  emoji: '🟩',
  description: "JavaScript on the server — event-driven I/O, REST APIs with Express, and the npm ecosystem.",
  tags: ['Backend', 'JavaScript', 'API'],
  categories: [
    {
      id: 'node-basics',
      title: 'Node.js Basics',
      topics: [
        {
          id: 'node-runtime',
          title: 'The Runtime',
          lessons: [
            lesson('node-rt-what', 'What is Node.js (V8 + libuv)'),
            lesson('node-rt-loop', 'Event loop in Node.js'),
            lesson('node-rt-globals', 'Global objects (process, __dirname, __filename, Buffer)'),
            lesson('node-rt-cjs', 'CommonJS (require / module.exports)'),
            lesson('node-rt-esm', 'ESM (import/export) in Node'),
          ],
        },
        {
          id: 'node-builtins',
          title: 'Built-in Modules',
          lessons: [
            lesson('node-mod-fs', 'fs — reading & writing files (sync & async)'),
            lesson('node-mod-path', 'path — joining & resolving paths'),
            lesson('node-mod-os', 'os — system info'),
            lesson('node-mod-events', 'events — EventEmitter'),
            lesson('node-mod-stream', 'stream — readable & writable streams'),
            lesson('node-mod-crypto', 'crypto — hashing & encryption'),
            lesson('node-mod-http', 'http — raw HTTP server'),
          ],
        },
        {
          id: 'node-npm',
          title: 'npm',
          lessons: [
            lesson('node-npm-init', 'package.json & npm init'),
            lesson('node-npm-install', 'npm install & devDependencies'),
            lesson('node-npm-scripts', 'npm scripts (start, dev, build, test)'),
            lesson('node-npm-semver', 'Semver (^, ~, exact)'),
            lesson('node-npm-lockfile', 'package-lock.json — why it matters'),
          ],
        },
      ],
    },
    {
      id: 'node-express',
      title: 'Express',
      topics: [
        {
          id: 'express-basics',
          title: 'Express Basics',
          lessons: [
            lesson('exp-bas-setup', 'express() & app.listen()'),
            lesson('exp-bas-get', 'GET route'),
            lesson('exp-bas-post', 'POST route'),
            lesson('exp-bas-put-del', 'PUT & DELETE routes'),
            lesson('exp-bas-req-res', 'req & res objects'),
          ],
        },
        {
          id: 'express-middleware',
          title: 'Middleware',
          lessons: [
            lesson('exp-mw-concept', 'Middleware concept & app.use()'),
            lesson('exp-mw-json', 'Built-in: express.json() & express.urlencoded()'),
            lesson('exp-mw-static', 'Built-in: express.static()'),
            lesson('exp-mw-next', 'next() function'),
            lesson('exp-mw-error', 'Error middleware (err, req, res, next)'),
          ],
        },
        {
          id: 'express-routing',
          title: 'Routing',
          lessons: [
            lesson('exp-rt-router', 'express.Router()'),
            lesson('exp-rt-params', 'Route params (:id)'),
            lesson('exp-rt-query', 'Query params (req.query)'),
            lesson('exp-rt-body', 'Request body (req.body)'),
            lesson('exp-rt-group', 'Route grouping & prefixes'),
          ],
        },
        {
          id: 'express-response',
          title: 'Responses',
          lessons: [
            lesson('exp-res-json', 'res.json()'),
            lesson('exp-res-status', 'res.status(404).json(...)'),
            lesson('exp-res-send', 'res.send() & res.redirect()'),
            lesson('exp-res-codes', 'HTTP status codes (200, 201, 400, 401, 403, 404, 500)'),
          ],
        },
      ],
    },
    {
      id: 'node-env-config',
      title: 'Environment & Config',
      topics: [
        {
          id: 'node-env',
          title: 'Environment Variables',
          lessons: [
            lesson('node-env-dotenv', 'dotenv & .env files'),
            lesson('node-env-process', 'process.env.*'),
            lesson('node-env-nodeenv', 'NODE_ENV (development / production)'),
          ],
        },
        {
          id: 'node-validation',
          title: 'Validation',
          lessons: [
            lesson('node-val-zod', 'Zod for request body validation'),
            lesson('node-val-errors', 'Returning validation errors as JSON'),
          ],
        },
        {
          id: 'node-auth',
          title: 'Authentication',
          lessons: [
            lesson('node-auth-jwt', 'JWT (jsonwebtoken) — sign & verify'),
            lesson('node-auth-bcrypt', 'bcrypt — hashing passwords'),
            lesson('node-auth-mw', 'Auth middleware pattern'),
            lesson('node-auth-cookie', 'Cookie-based sessions'),
          ],
        },
      ],
    },
    {
      id: 'node-testing',
      title: 'Testing',
      topics: [
        {
          id: 'node-test-jest',
          title: 'Testing with Jest',
          lessons: [
            lesson('node-test-jest-basics', 'Jest setup for Node'),
            lesson('node-test-supertest', 'supertest for API integration tests'),
            lesson('node-test-mock', 'Mocking modules'),
            lesson('node-test-async', 'Testing async code'),
          ],
        },
      ],
    },
  ],
}

// ─── SQL / DATABASES ──────────────────────────────────────────────────────────

const sql: CatalogDomain = {
  id: 'sql',
  title: 'SQL & Databases',
  emoji: '🗄️',
  description: "Relational databases and SQL — from basic queries to joins, transactions, and working with ORMs.",
  tags: ['Backend', 'Database', 'Fundamentals'],
  categories: [
    {
      id: 'sql-concepts',
      title: 'Relational Concepts',
      topics: [
        {
          id: 'sql-model',
          title: 'Data Model',
          lessons: [
            lesson('sql-mod-tables', 'Tables, rows, and columns'),
            lesson('sql-mod-pk', 'Primary key'),
            lesson('sql-mod-fk', 'Foreign key'),
            lesson('sql-mod-rel', 'Relationships (1:1, 1:N, N:M)'),
            lesson('sql-mod-normal', 'Normalisation basics (1NF, 2NF, 3NF)'),
          ],
        },
        {
          id: 'sql-datatypes',
          title: 'Data Types',
          lessons: [
            lesson('sql-dt-text', 'TEXT / VARCHAR / CHAR'),
            lesson('sql-dt-num', 'INTEGER / NUMERIC / DECIMAL / FLOAT'),
            lesson('sql-dt-bool', 'BOOLEAN'),
            lesson('sql-dt-date', 'DATE / TIMESTAMP / TIMESTAMPTZ'),
            lesson('sql-dt-uuid', 'UUID'),
          ],
        },
      ],
    },
    {
      id: 'sql-querying',
      title: 'Querying Data',
      topics: [
        {
          id: 'sql-select',
          title: 'SELECT',
          lessons: [
            lesson('sql-sel-basic', 'SELECT FROM WHERE'),
            lesson('sql-sel-order', 'ORDER BY & LIMIT'),
            lesson('sql-sel-distinct', 'DISTINCT'),
            lesson('sql-sel-alias', 'Column & table aliases (AS)'),
          ],
        },
        {
          id: 'sql-filtering',
          title: 'Filtering',
          lessons: [
            lesson('sql-flt-and-or', 'AND / OR / NOT'),
            lesson('sql-flt-between', 'BETWEEN'),
            lesson('sql-flt-in', 'IN / NOT IN'),
            lesson('sql-flt-like', 'LIKE & ILIKE (case-insensitive)'),
            lesson('sql-flt-null', 'IS NULL / IS NOT NULL'),
          ],
        },
        {
          id: 'sql-aggregates',
          title: 'Aggregate Functions',
          lessons: [
            lesson('sql-agg-count', 'COUNT()'),
            lesson('sql-agg-sum', 'SUM() & AVG()'),
            lesson('sql-agg-minmax', 'MIN() & MAX()'),
            lesson('sql-agg-groupby', 'GROUP BY'),
            lesson('sql-agg-having', 'HAVING'),
          ],
        },
        {
          id: 'sql-joins',
          title: 'JOINs',
          lessons: [
            lesson('sql-join-inner', 'INNER JOIN'),
            lesson('sql-join-left', 'LEFT JOIN'),
            lesson('sql-join-right', 'RIGHT JOIN'),
            lesson('sql-join-full', 'FULL OUTER JOIN'),
            lesson('sql-join-self', 'Self JOIN'),
            lesson('sql-join-cross', 'CROSS JOIN'),
          ],
        },
        {
          id: 'sql-subqueries',
          title: 'Subqueries',
          lessons: [
            lesson('sql-sub-basic', 'Subquery in WHERE'),
            lesson('sql-sub-correlated', 'Correlated subqueries'),
            lesson('sql-sub-exists', 'EXISTS & NOT EXISTS'),
            lesson('sql-sub-cte', 'CTEs (WITH ... AS)'),
          ],
        },
        {
          id: 'sql-window',
          title: 'Window Functions',
          lessons: [
            lesson('sql-win-rownumber', 'ROW_NUMBER()'),
            lesson('sql-win-rank', 'RANK() & DENSE_RANK()'),
            lesson('sql-win-partition', 'PARTITION BY'),
            lesson('sql-win-lag', 'LAG() & LEAD()'),
          ],
        },
      ],
    },
    {
      id: 'sql-ddl-dml',
      title: 'Defining & Modifying Data',
      topics: [
        {
          id: 'sql-ddl',
          title: 'DDL',
          lessons: [
            lesson('sql-ddl-create', 'CREATE TABLE'),
            lesson('sql-ddl-alter', 'ALTER TABLE (add/drop/rename column)'),
            lesson('sql-ddl-drop', 'DROP TABLE'),
            lesson('sql-ddl-constraints', 'Constraints (NOT NULL, UNIQUE, CHECK, DEFAULT)'),
          ],
        },
        {
          id: 'sql-dml',
          title: 'DML',
          lessons: [
            lesson('sql-dml-insert', 'INSERT INTO'),
            lesson('sql-dml-update', 'UPDATE ... SET ... WHERE'),
            lesson('sql-dml-delete', 'DELETE FROM ... WHERE'),
            lesson('sql-dml-upsert', 'Upsert (ON CONFLICT DO UPDATE)'),
          ],
        },
        {
          id: 'sql-transactions',
          title: 'Transactions',
          lessons: [
            lesson('sql-tx-begin', 'BEGIN / COMMIT / ROLLBACK'),
            lesson('sql-tx-acid', 'ACID properties'),
            lesson('sql-tx-isolation', 'Isolation levels'),
            lesson('sql-tx-savepoint', 'SAVEPOINT'),
          ],
        },
        {
          id: 'sql-indexes',
          title: 'Indexes',
          lessons: [
            lesson('sql-idx-create', 'CREATE INDEX'),
            lesson('sql-idx-types', 'B-tree vs hash vs GiST indexes'),
            lesson('sql-idx-when', 'When to add an index'),
            lesson('sql-idx-explain', 'EXPLAIN ANALYZE'),
          ],
        },
      ],
    },
    {
      id: 'sql-postgresql',
      title: 'PostgreSQL Specifics',
      topics: [
        {
          id: 'pg-features',
          title: 'PostgreSQL Features',
          lessons: [
            lesson('pg-json', 'JSONB column type'),
            lesson('pg-arrays', 'Array columns'),
            lesson('pg-fulltext', 'Full-text search (tsvector, tsquery)'),
            lesson('pg-rls', 'Row-Level Security (RLS) basics'),
          ],
        },
        {
          id: 'sql-ormstools',
          title: 'ORMs & Tools',
          lessons: [
            lesson('sql-orm-prisma', 'Prisma basics (schema, migrate, client)'),
            lesson('sql-orm-drizzle', 'Drizzle ORM basics'),
            lesson('sql-orm-vs-raw', 'ORM vs raw SQL — when to use each'),
          ],
        },
      ],
    },
  ],
}

// ─── SPRING BOOT ──────────────────────────────────────────────────────────────

const springBoot: CatalogDomain = {
  id: 'spring-boot',
  title: 'Spring Boot',
  emoji: '🍃',
  description: "Java's most popular framework for building production-grade REST APIs, microservices, and enterprise apps.",
  tags: ['Backend', 'Java', 'Framework'],
  categories: [
    {
      id: 'spring-core',
      title: 'Spring Core',
      topics: [
        {
          id: 'spring-ioc',
          title: 'IoC & Dependency Injection',
          lessons: [
            lesson('spring-ioc-concept', 'Inversion of Control concept'),
            lesson('spring-ioc-di', 'Dependency Injection'),
            lesson('spring-ioc-bean', 'What is a Bean'),
            lesson('spring-ioc-context', 'ApplicationContext'),
          ],
        },
        {
          id: 'spring-annotations',
          title: 'Core Annotations',
          lessons: [
            lesson('spring-ann-component', '@Component'),
            lesson('spring-ann-service', '@Service'),
            lesson('spring-ann-repo', '@Repository'),
            lesson('spring-ann-controller', '@Controller & @RestController'),
            lesson('spring-ann-autowired', '@Autowired & constructor injection'),
            lesson('spring-ann-config', '@Configuration & @Bean'),
          ],
        },
      ],
    },
    {
      id: 'spring-boot-basics',
      title: 'Spring Boot',
      topics: [
        {
          id: 'spring-boot-setup',
          title: 'Setup',
          lessons: [
            lesson('sb-setup-initializr', 'Spring Initializr (start.spring.io)'),
            lesson('sb-setup-structure', 'Project structure'),
            lesson('sb-setup-auto', 'Auto-configuration concept'),
            lesson('sb-setup-props', 'application.properties & application.yml'),
            lesson('sb-setup-profiles', 'Profiles (dev, prod)'),
          ],
        },
        {
          id: 'spring-boot-run',
          title: 'Running & Config',
          lessons: [
            lesson('sb-run-main', '@SpringBootApplication & main()'),
            lesson('sb-run-value', '@Value injection'),
            lesson('sb-run-configprops', '@ConfigurationProperties'),
            lesson('sb-run-actuator', 'Spring Actuator (health, metrics)'),
          ],
        },
      ],
    },
    {
      id: 'spring-rest',
      title: 'REST API',
      topics: [
        {
          id: 'spring-rest-basics',
          title: 'REST Basics',
          lessons: [
            lesson('spring-rest-mapping', '@RequestMapping & @GetMapping'),
            lesson('spring-rest-post', '@PostMapping & @PutMapping & @DeleteMapping'),
            lesson('spring-rest-body', '@RequestBody'),
            lesson('spring-rest-path', '@PathVariable'),
            lesson('spring-rest-param', '@RequestParam'),
            lesson('spring-rest-entity', 'ResponseEntity<T>'),
          ],
        },
        {
          id: 'spring-rest-validation',
          title: 'Validation',
          lessons: [
            lesson('spring-val-valid', '@Valid & @Validated'),
            lesson('spring-val-notnull', '@NotNull @Size @Email @Min @Max'),
            lesson('spring-val-errors', 'MethodArgumentNotValidException'),
          ],
        },
        {
          id: 'spring-rest-errors',
          title: 'Error Handling',
          lessons: [
            lesson('spring-err-advice', '@ControllerAdvice'),
            lesson('spring-err-handler', '@ExceptionHandler'),
            lesson('spring-err-global', 'Global exception handler pattern'),
            lesson('spring-err-problem', 'ProblemDetail (RFC 7807)'),
          ],
        },
      ],
    },
    {
      id: 'spring-data',
      title: 'Spring Data JPA',
      topics: [
        {
          id: 'spring-jpa-basics',
          title: 'JPA Basics',
          lessons: [
            lesson('spring-jpa-entity', '@Entity & @Id & @GeneratedValue'),
            lesson('spring-jpa-table', '@Table & @Column'),
            lesson('spring-jpa-repo', 'JpaRepository<T, ID>'),
            lesson('spring-jpa-derived', 'Derived query methods (findByEmail...)'),
            lesson('spring-jpa-jpql', '@Query with JPQL'),
          ],
        },
        {
          id: 'spring-jpa-relations',
          title: 'Relationships',
          lessons: [
            lesson('spring-jpa-onetomany', '@OneToMany & @ManyToOne'),
            lesson('spring-jpa-manytomany', '@ManyToMany'),
            lesson('spring-jpa-cascade', 'CascadeType & FetchType (LAZY vs EAGER)'),
            lesson('spring-jpa-n1', 'N+1 problem & @EntityGraph'),
          ],
        },
      ],
    },
    {
      id: 'spring-security',
      title: 'Security',
      topics: [
        {
          id: 'spring-sec-basics',
          title: 'Security Basics',
          lessons: [
            lesson('spring-sec-config', 'SecurityFilterChain'),
            lesson('spring-sec-auth', 'Authentication vs authorisation'),
            lesson('spring-sec-basic', 'HTTP Basic auth'),
            lesson('spring-sec-jwt', 'JWT filter for stateless auth'),
            lesson('spring-sec-preauth', '@PreAuthorize & @Secured'),
          ],
        },
      ],
    },
    {
      id: 'spring-testing',
      title: 'Testing',
      topics: [
        {
          id: 'spring-test-basics',
          title: 'Testing',
          lessons: [
            lesson('spring-test-boot', '@SpringBootTest'),
            lesson('spring-test-mockbean', '@MockBean'),
            lesson('spring-test-mockmvc', 'MockMvc'),
            lesson('spring-test-webmvc', '@WebMvcTest'),
            lesson('spring-test-datajpa', '@DataJpaTest'),
          ],
        },
      ],
    },
  ],
}

// ─── DOCKER ───────────────────────────────────────────────────────────────────

const docker: CatalogDomain = {
  id: 'docker',
  title: 'Docker',
  emoji: '🐳',
  description: "Container-based packaging for consistent, portable deployments — from local dev to production.",
  tags: ['DevOps', 'Tooling', 'Infrastructure'],
  categories: [
    {
      id: 'docker-concepts',
      title: 'Concepts',
      topics: [
        {
          id: 'docker-why',
          title: 'Why Docker',
          lessons: [
            lesson('docker-why-containers', 'Containers vs VMs'),
            lesson('docker-why-images', 'Images vs containers'),
            lesson('docker-why-daemon', 'Docker daemon & CLI'),
            lesson('docker-why-hub', 'Docker Hub & registries'),
          ],
        },
      ],
    },
    {
      id: 'docker-dockerfile',
      title: 'Dockerfile',
      topics: [
        {
          id: 'docker-instructions',
          title: 'Dockerfile Instructions',
          lessons: [
            lesson('docker-ins-from', 'FROM — base image'),
            lesson('docker-ins-run', 'RUN — execute commands'),
            lesson('docker-ins-copy', 'COPY & ADD'),
            lesson('docker-ins-workdir', 'WORKDIR'),
            lesson('docker-ins-expose', 'EXPOSE'),
            lesson('docker-ins-cmd', 'CMD vs ENTRYPOINT'),
            lesson('docker-ins-arg-env', 'ARG & ENV'),
            lesson('docker-ins-ignore', '.dockerignore'),
          ],
        },
        {
          id: 'docker-multistage',
          title: 'Multi-stage Builds',
          lessons: [
            lesson('docker-ms-concept', 'Multi-stage concept (build vs runtime stage)'),
            lesson('docker-ms-copy', 'COPY --from=build'),
            lesson('docker-ms-size', 'Reducing final image size'),
            lesson('docker-ms-alpine', 'Alpine base images'),
          ],
        },
      ],
    },
    {
      id: 'docker-cli',
      title: 'Docker CLI',
      topics: [
        {
          id: 'docker-images-cli',
          title: 'Image Commands',
          lessons: [
            lesson('docker-cli-build', 'docker build -t name:tag .'),
            lesson('docker-cli-images', 'docker images & docker rmi'),
            lesson('docker-cli-pull', 'docker pull'),
            lesson('docker-cli-push', 'docker push'),
          ],
        },
        {
          id: 'docker-containers-cli',
          title: 'Container Commands',
          lessons: [
            lesson('docker-cli-run', 'docker run'),
            lesson('docker-cli-run-flags', '-d (detach), --name, --rm, -it'),
            lesson('docker-cli-ps', 'docker ps & docker ps -a'),
            lesson('docker-cli-stop', 'docker stop & docker rm'),
            lesson('docker-cli-exec', 'docker exec -it (shell into container)'),
            lesson('docker-cli-logs', 'docker logs'),
          ],
        },
        {
          id: 'docker-port-volume',
          title: 'Ports & Volumes',
          lessons: [
            lesson('docker-port-map', 'Port mapping (-p 8080:80)'),
            lesson('docker-vol-bind', 'Bind mounts (-v $(pwd):/app)'),
            lesson('docker-vol-named', 'Named volumes'),
            lesson('docker-vol-manage', 'docker volume ls & rm'),
          ],
        },
      ],
    },
    {
      id: 'docker-compose',
      title: 'Docker Compose',
      topics: [
        {
          id: 'docker-compose-basics',
          title: 'compose.yml',
          lessons: [
            lesson('docker-cmp-services', 'services definition'),
            lesson('docker-cmp-image', 'image vs build'),
            lesson('docker-cmp-ports', 'ports mapping'),
            lesson('docker-cmp-env', 'environment variables'),
            lesson('docker-cmp-volumes', 'volumes'),
            lesson('docker-cmp-depends', 'depends_on'),
          ],
        },
        {
          id: 'docker-compose-commands',
          title: 'Compose Commands',
          lessons: [
            lesson('docker-cmp-up', 'docker compose up & up -d'),
            lesson('docker-cmp-down', 'docker compose down'),
            lesson('docker-cmp-logs', 'docker compose logs -f'),
            lesson('docker-cmp-exec', 'docker compose exec'),
          ],
        },
        {
          id: 'docker-networking',
          title: 'Networking',
          lessons: [
            lesson('docker-net-bridge', 'Default bridge network'),
            lesson('docker-net-custom', 'Custom networks'),
            lesson('docker-net-dns', 'Service name as DNS (service-to-service)'),
          ],
        },
      ],
    },
    {
      id: 'docker-best-practices',
      title: 'Best Practices',
      topics: [
        {
          id: 'docker-bp',
          title: 'Best Practices',
          lessons: [
            lesson('docker-bp-layers', 'Layer caching strategy'),
            lesson('docker-bp-nonroot', 'Non-root user (USER directive)'),
            lesson('docker-bp-health', 'HEALTHCHECK'),
            lesson('docker-bp-small', 'Keeping images small'),
          ],
        },
      ],
    },
  ],
}

// ─── RAG / EMBEDDINGS ─────────────────────────────────────────────────────────

const rag: CatalogDomain = {
  id: 'rag-embeddings',
  title: 'RAG & Embeddings',
  emoji: '🔍',
  description: "Retrieval-Augmented Generation — giving LLMs access to your data through semantic search and vector databases.",
  tags: ['AI/ML', 'LLM', 'Backend'],
  categories: [
    {
      id: 'rag-concepts',
      title: 'Concepts',
      topics: [
        {
          id: 'rag-what',
          title: 'What is RAG',
          lessons: [
            lesson('rag-why', 'Why RAG (overcoming knowledge cutoff & hallucination)'),
            lesson('rag-components', 'RAG components: Retriever + Generator'),
            lesson('rag-vs-finetuning', 'RAG vs fine-tuning — when to use each'),
            lesson('rag-pipeline-overview', 'RAG pipeline overview (ingest → query → generate)'),
          ],
        },
        {
          id: 'embeddings-basics',
          title: 'Embeddings',
          lessons: [
            lesson('emb-what', 'What are embeddings (vectors that encode meaning)'),
            lesson('emb-similarity', 'Semantic similarity'),
            lesson('emb-cosine', 'Cosine similarity'),
            lesson('emb-dot', 'Dot product & Euclidean distance'),
          ],
        },
        {
          id: 'embedding-models',
          title: 'Embedding Models',
          lessons: [
            lesson('emb-openai', 'OpenAI text-embedding-3-small & large'),
            lesson('emb-voyage', 'Voyage AI (Anthropic-preferred)'),
            lesson('emb-sentence-trans', 'sentence-transformers (open-source)'),
            lesson('emb-cohere', 'Cohere Embed'),
            lesson('emb-choosing', 'Choosing an embedding model (dimension, speed, cost)'),
          ],
        },
      ],
    },
    {
      id: 'rag-vector-dbs',
      title: 'Vector Databases',
      topics: [
        {
          id: 'vectordb-basics',
          title: 'Vector DB Concepts',
          lessons: [
            lesson('vdb-what', 'What are vector databases'),
            lesson('vdb-ann', 'Approximate Nearest Neighbour (ANN) search'),
            lesson('vdb-hnsw', 'HNSW index'),
            lesson('vdb-metadata', 'Metadata filtering alongside vector search'),
          ],
        },
        {
          id: 'vectordb-options',
          title: 'Popular Vector DBs',
          lessons: [
            lesson('vdb-pgvector', 'pgvector (PostgreSQL extension)'),
            lesson('vdb-pinecone', 'Pinecone (managed, serverless)'),
            lesson('vdb-chroma', 'Chroma (local, open-source)'),
            lesson('vdb-weaviate', 'Weaviate (hybrid search)'),
            lesson('vdb-supabase-pg', 'Supabase + pgvector'),
          ],
        },
      ],
    },
    {
      id: 'rag-pipeline',
      title: 'Building the Pipeline',
      topics: [
        {
          id: 'rag-ingest',
          title: 'Ingest Phase',
          lessons: [
            lesson('rag-load', 'Loading documents (PDF, Markdown, HTML, DB)'),
            lesson('rag-chunk-fixed', 'Fixed-size chunking'),
            lesson('rag-chunk-recursive', 'Recursive character text splitter'),
            lesson('rag-chunk-semantic', 'Semantic chunking'),
            lesson('rag-chunk-overlap', 'Chunk overlap & why it matters'),
            lesson('rag-embed-store', 'Embedding chunks & storing in vector DB'),
          ],
        },
        {
          id: 'rag-retrieval',
          title: 'Retrieval Phase',
          lessons: [
            lesson('rag-query-embed', 'Embedding the user query'),
            lesson('rag-topk', 'Top-k similarity search'),
            lesson('rag-hybrid', 'Hybrid search (keyword + semantic)'),
            lesson('rag-rerank', 'Re-ranking results'),
            lesson('rag-metadata-filter', 'Metadata filtering'),
          ],
        },
        {
          id: 'rag-generation',
          title: 'Generation Phase',
          lessons: [
            lesson('rag-augment', 'Augmenting the prompt with retrieved context'),
            lesson('rag-prompt-template', 'RAG prompt template'),
            lesson('rag-citations', 'Source citations & grounding'),
            lesson('rag-streaming', 'Streaming the response'),
          ],
        },
      ],
    },
    {
      id: 'rag-advanced',
      title: 'Advanced RAG',
      topics: [
        {
          id: 'rag-advanced-techniques',
          title: 'Advanced Techniques',
          lessons: [
            lesson('rag-hyde', 'HyDE (Hypothetical Document Embeddings)'),
            lesson('rag-parent-child', 'Parent-child chunking'),
            lesson('rag-multi-query', 'Multi-query retrieval'),
            lesson('rag-contextual-compression', 'Contextual compression'),
            lesson('rag-raptor', 'RAPTOR (recursive summarisation)'),
          ],
        },
        {
          id: 'rag-eval',
          title: 'Evaluation',
          lessons: [
            lesson('rag-eval-faithfulness', 'Faithfulness (is the answer grounded?)'),
            lesson('rag-eval-relevancy', 'Answer relevancy'),
            lesson('rag-eval-context', 'Context precision & recall'),
            lesson('rag-eval-ragas', 'RAGAS evaluation framework'),
          ],
        },
        {
          id: 'rag-frameworks',
          title: 'Frameworks',
          lessons: [
            lesson('rag-langchain', 'LangChain RAG chain basics'),
            lesson('rag-llamaindex', 'LlamaIndex VectorStoreIndex'),
            lesson('rag-no-framework', 'Building RAG without a framework'),
          ],
        },
      ],
    },
  ],
}

// ─── CATALOG EXPORT ───────────────────────────────────────────────────────────

export const TOOL_CATALOG: CatalogDomain[] = [
  git,
  typescript,
  java,
  javascript,
  python,
  nodejs,
  react,
  nextjs,
  tailwind,
  vite,
  sql,
  springBoot,
  docker,
  claude,
  chatgpt,
  githubCopilot,
  rag,
]

export function getDomainLessons(domain: CatalogDomain): Lesson[] {
  return domain.categories.flatMap((cat) =>
    cat.topics.flatMap((topic) => topic.lessons)
  )
}

export function getCategoryLessons(category: CatalogCategory): Lesson[] {
  return category.topics.flatMap((topic) => topic.lessons)
}

export function getTopicLessons(topic: CatalogTopic): Lesson[] {
  return topic.lessons
}

export function getDomainLessonCount(domain: CatalogDomain): number {
  return getDomainLessons(domain).length
}

export function findLessonById(id: string): Lesson | undefined {
  for (const domain of TOOL_CATALOG) {
    for (const cat of domain.categories) {
      for (const topic of cat.topics) {
        const lesson = topic.lessons.find((l) => l.id === id)
        if (lesson) return lesson
      }
    }
  }
  return undefined
}
