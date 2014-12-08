var fs = require('fs-extra'),
  util = require('util'),
  Q = require('q'),
  xml2js = require('xml2js'),
  cheerio = require('cheerio')

// Set this to the section you work on to speed up the generation.
// But remember to remove it again! :)
var filterGroup = 'math';

// Check for sass compatibility (it does not work on Travis-ci)
try {
  var sass = require('node-sass');

  //Create the css file from the scss file in assets
  sass.renderFile({
    file: 'assets/stylesheet.scss',
    outFile: 'output/stylesheet.css',
    error: function(error) {
      console.error(error);
    },
    success: function(){}
  });
} catch(e){
  console.log("Sass not installed, skipping");
  filterGroup = '';
}


var root =  process.argv[2] || "../..";
var dir = root + "/libs/openFrameworksCompiled/project/doxygen/build/";
console.log("Openframeworks root: "+root);

//Create the output folder
if(fs.existsSync('output'))
  fs.removeSync('output');
fs.mkdirSync('output');

// Copy assets
fs.copySync('assets/script.js', 'output/script.js');
fs.copySync('assets/search.js', 'output/search.js');
fs.copySync('assets/fuse.min.js', 'output/fuse.min.js');

// Copy the images over from the docs folder
fs.copySync(root+'/docs/images', 'output/images');



// Load the doc structure
var tocInfo = {};
var searchToc = [];

// Load the structure from the doxygen xml
loadStructure()

  // Then generate the docs of all the pages
  .then(function(structure){
    var promises = [];

    // Iterate over the categories
    for (var category in structure['core']) {

      structure['core'][category].forEach(function (file) {
        file.category = category;

        // Generate the doc of the file
        var p = generateDoc(file)
          .then(function(){
            console.log(file)
          })
          // If the doc fails, remove it from the structure so it's not shown on the frontpage
          .fail(function (e) {
            console.error("Error generatic doc:", e, file, file.category)
            var index = structure['core'][file.category].indexOf(file);
            structure['core'][file.category].splice(index, 1);
          });

        promises.push(p);

      })
    }

    // When all the docs have been generated, then create the TOC
    return Q.all(promises)
      .then(function(){
        return structure;
      })

  })

  // Then generate the TOC and search json
  .then(function(structure){
    console.log("Generate toc");
    // Generate the TOC (index.html)
    generateToc(structure, tocInfo);

    console.log("Generate search json");
    generateSearchTocJSON(structure, searchToc);
  })

  // Fall back
  .fail(function(e){
    console.error("General critical error! ",e)
  });

// ---------
// ---------
// ---------


function loadStructure(){
  var promises = [];
  var structure = {core: {}};

  var files = fs.readdirSync(dir+'xml');
  files.forEach(function(f){
    if(f.match(/^dir_/)){
      var deferred = Q.defer();

      var xmlData = fs.readFileSync(dir+'xml/'+f);
      var xmlParser = new xml2js.Parser();
      xmlParser.parseString(xmlData, function (err, result) {
        var compoundname = result['doxygen']['compounddef'][0]['compoundname'][0].match(/\/(\w+)$/)[1];

        // Filter out the root dir xml that descripes the openframeworks base folder
        if(!compoundname.match(/openframeworks$/i)) {
          //console.log('"' + compoundname + '"', '"' + filterGroup + '"', filterGroup != compoundname);
          if (filterGroup && filterGroup != compoundname) {

          } else {

            //    console.log(f, compoundname);
            //  console.log(result['doxygen']['compounddef'][0]['innerfile']);

            structure.core[compoundname] = [];
            result['doxygen']['compounddef'][0]['innerfile'].forEach(function (innerfile) {
              var filename = innerfile['_'];
              var refid = innerfile['$']['refid']

              //Is it a headerfile?
              if (filename.match(/\.h$/)) {
                structure.core[compoundname].push({
                  name: filename.replace(/\.h$/, ""),
                  ref: refid
                })
              }

            })
          }
        }

        deferred.resolve();
      });

      promises.push(deferred.promise);
    }
  });

  return Q.all(promises).then(function(){
    return structure;
  })

}

// ---------
// This is where it happens!
// The chain of `then` ensures that if one step fails, it will will stop parsing
//
function generateDoc(fileDescription) {
  var category = fileDescription.category;
  var className = fileDescription.name;
  var doxygenName = fileDescription.ref;

  console.log("Generate "+className)

  // First parse the doxygen xml
  return parseDoxygenXml(doxygenName)

    // Then scrape the doxygen html for descriptions
    .then(function(parseData) {
      console.log("Scrape "+className)

      return scrapeDoxygenHtml(parseData);
    })

    // Then generate search toc object
    .then(function(parsedData){
      addObjectToSearch(parsedData);

      return parsedData;
    })

    // Then generate the html output
    .then(function(parseData){
      console.log("Generate html "+className)

      return generateHtml(parseData, category);
    })

    // Then save the output file
    .then(function(html){
      //Save the html
      console.log("Save "+className)
      fs.writeFile("output/"+className+".html", html);
    })


}



// -----------

function parseDoxygenXml(doxygenName){
  var deferred = Q.defer();

  var ret = {
    classes: [],
    sections: [],
    doxygenName: doxygenName,
    xmlPath: dir + "xml/" + doxygenName + ".xml",
    htmlPath: dir + "html/" + doxygenName + ".html"
  };

  //Load the doxygen xml file
  var xmlData = fs.readFileSync(ret.xmlPath);
  var xmlParser = new xml2js.Parser();
  xmlParser.parseString(xmlData, function (err, result) {

    var promises = [];

    // The compounds in the XML
    var compounds = result['doxygen']['compounddef'];

    // compounds.length is always 1
    for (var i = 0; i < compounds.length; i++) {
      var compound = compounds[i];

      // Object name
      ret.name = compound['compoundname'][0].replace(".h","");

      // Object url
      ret.url = compound['location'][0]['$']['file'].match(/\/(\w+).h$/)[1]+".html";

      // Object type
      ret.kind = compound['$'].kind;


      // Brief description
      if (compound['briefdescription'].length == 1
        && compound['briefdescription'][0]['para']) {
        tocInfo[ret.name] = compound['briefdescription'][0]['para'][0];
        ret.briefDescription = compound['briefdescription'][0]['para'][0];
      } else {
        console.error("Missing briefDescription on " + ret.name);
      }

      // Sections
      if (compound['sectiondef']) {
        compound['sectiondef'].forEach(function (s) {
          var section = {
            name: "",
            methods: [],
            user_defined: true
          };

          // Section name
          if (s['header']) {
            // User generated name
            section.name = s.header[0]
          } else {
            // Default names
            switch (s['$'].kind) {
              case 'public-func':
                section.name = "Public Functions";
                break;
              case 'public-type':
                section.name = "Public Types";
                break;
              case 'public-attrib':
                section.name = "Public Attributes";
                break;
              case 'public-static-func':
                section.name = "Public Static Functions";
                break;
              case 'public-static-attrib':
                section.name = "Public Static Attributes";
                break;

              case 'protected-attrib':
                section.name = "Protected Attributes";
                break;

              case 'protected-static-attrib':
                section.name = "Protected Static Attributes";
                break;
              case 'protected-func':
                section.name = "Protected Functions";
                break;

              case 'define':
                section.name = "Defines";
                break;

              case 'func':
                section.name = "Functions";
                break;

              case 'enum':
                section.name = "Enums";
                break;

              case 'typedef':
                section.name = "Typedefs";
                break;

              case 'var':
                section.name = "Variables";
                break;

              case 'friend':
                section.name = "Friends";
                break;

              // Hide these, they are private and not intended for public use:
              case 'private-static-attrib':
              case 'private-static-func':
              case 'private-attrib':
              case 'private-func':
                return;
                break;

              default:
                console.error("Missing header name for " + s['$'].kind);

                section.name = "!! Missing header !!"
            }
          }

          // Section anchor
          section.anchor = section.name.replace(/ /g, '');

          // Members in the section
          var lastName = '';
          s.memberdef.forEach(function (member) {
            var m = {
              info: member['$'],
              name: member.name[0],
              type: member.type ? member.type[0] : "",
              definition: member.definition ? member.definition[0] : "",
              argsstring: member.argsstring ? member.argsstring[0] : ""
            };

            // Member ref (anchor)
            m.ref = m.info.id.replace(doxygenName + "_1", "");

            // Member kind
            m.kind = m.info.kind;

            // Member name
            if (m.name.match(/^@/g)) {
              m.name = "Anonymous " + m.info.kind;
            }

            // Handle deprecated functions
            if (m.name == "OF_DEPRECATED_MSG") {
              m.deprecated = true;
              try {
                //      (" msg"   ,   bla  )
                var deprecatedRegex = m.argsstring.match(/^\("(.*)"\s*,\s*(.*)\)$/i)
                //console.log(deprecatedRegex[2]);

                var funcRegex = deprecatedRegex[2].match(/(?:(.*)[\s&\*])?(\w*)(\(.*\))/i)
                //console.log(funcRegex);

                m.note = deprecatedRegex[1];

                m.type = (funcRegex[1] ? funcRegex[1] : 'void').trim();
                m.name = funcRegex[2].trim();
                m.argsstring = funcRegex[3].trim();
              } catch (e) {
                //console.log(m.argsstring);
                console.error("Error parsing deprecated message", e);
              }
              //console.log(m.type, m.name, m.argsstring)
            }

            // Group functions with the same name under one method as different implementations
            if (lastName != m.name) {
              section.methods.push({implementations: [m]});
            } else {
              section.methods[section.methods.length - 1].implementations.push(m);
            }
            lastName = m.name;
          });

          // Add the section
          ret.sections.push(section);

        });
      }

      // Inner classes
      if (compound['innerclass']) {

        compound['innerclass'].forEach(function (innerclass) {
          var p = Q.defer();

          var innerClassDoxygenName = innerclass['$']['refid'];

          // Parse the xml of the inner class
          parseDoxygenXml(innerClassDoxygenName)
            .then(function(classData){
              // If there where no errors, add it to the classes array
              ret.classes.push(classData);
            })
            .fail(function(e){
              console.log(innerClassDoxygenName+" skipped since it could not be parsed",e);
            })
            .done(function(){
              // Resolve no matter if there was an error or not.
              // If there was an error its just not added to the classes, but the rest
              // of the file should not fail
              p.resolve();
            });

          promises.push(p.promise);

        });
      }
    }

    // Wait for all the parsing of inner classes to finish
    Q.all(promises)
      .then(function(){
        console.log("Done with "+doxygenName);

        // If there are no classes or sections, return an error
        if(ret.classes.length == 0 && ret.sections.length == 0){
          // "Empty" file, let's remove it
          console.log(doxygenName + " is empty");
          deferred.reject("Object has no members or sections");
          return;
        }

        deferred.resolve(ret);
      })
      .fail(function(e){
        deferred.reject(e);
      })

  });

  return deferred.promise;

}

// -----------

function scrapeDoxygenHtml(parsedData){
  var promises = [];

  if(!fs.existsSync(parsedData.htmlPath)){
    console.error("Missing html for "+parsedData.name + " "+parsedData.htmlPath)
    return Q.all([]);
  }
  var htmlData = fs.readFileSync(parsedData.htmlPath);
  parsedData.htmlData = htmlData;

  var $input = cheerio.load(htmlData.toString());

  // Overall description
  $input(".groupheader").each(function (i, elm) {
    if ($input(elm).text() == "Detailed Description") {
      parsedData.description = $input(elm).next();
    }
  });


  // Classes
  parsedData.classes.forEach(function (innerclass) {
    var p = scrapeDoxygenHtml(innerclass).then(function(parsedData){
      innerclass = parsedData;
    });

    promises.push(p);
  });


  // Sections
  parsedData.sections.forEach(function (section) {
    // Find description of section
    $input("div.groupHeader").each(function (i, elm) {
      if ($input(elm).text() == section.name) {
        //This is not the best solution, but the only i could find to find the section description....
        section.description = $input(elm).closest('tr').next().find('.groupText').html();
      }
    });

    // Go through all methods in the section
    section.methods.forEach(function (memberGroup) {
      memberGroup.implementations.forEach(function(method) {
        // Description

        // Find the coresponding description in the doxygen generated html
        var ref = method.info.id.replace(parsedData.doxygenName + "_1", "");
        var refElm = $input("#" + ref);

        if (!refElm) {
          console.error("Missing docs!")
        } else {
          var memitem = refElm.next();

          var memdoc = memitem.children('.memdoc');
          //if(memitem.is('.memdoc')) {
          if (memdoc.html()) {

            method.htmlDescription = memdoc.html();
          }
        }
      })
    });
  });


  return Q.all(promises).then(function(){
    return parsedData;
  });
}

// ----------

function addObjectToSearch(parsedData){
  searchToc.push({name:parsedData.name, type:parsedData.kind, ref:parsedData.url})

  parsedData.sections.forEach(function (section) {
    section.methods.forEach(function(method){
      var ref = method.implementations[0].ref;
      searchToc.push({
        name:method.implementations[0].name,
        type:method.implementations[0].info.kind,
        ref:parsedData.url+"#"+ref
      })
    });

    // Inner classes
    parsedData.classes.forEach(function(innerclass){
      addObjectToSearch(innerclass);
    });

  });


}

// -----------

function generateHtml(parsedData, category){
  var templateData = fs.readFileSync("template.html");

  var $ = cheerio.load(templateData.toString());

  // Page title
  $('title').text(parsedData.name);

  //Quick nav
  $('#classQuickNav').text(parsedData.name);
  $('#categoryQuickNav').text(category);


  // Global  members
  generateHtmlContent(parsedData, $);

  // Inner classes
  parsedData.classes.forEach(function(innerclass){
    $("#topics").append('<span class="class">'+innerclass.name+'</span>');

    generateHtmlContent(innerclass, $);
  });


  // update links
  var links = $('a');
  links.each(function(i,elm){
    updateLink($(this));
  });

  // update images
  var images = $('img');
  images.each(function(i,elm){
    updateImageHref($(this));
  });

  return $.html();
}

// -----------

function generateHtmlContent(parsedData, $){

  var classTemplate = $('#classTemplate').clone().attr('id','');

  // Class description
  var kind = "";
  if(parsedData.kind){
    kind = "<small>"+parsedData.kind+"</small>";
  }
  classTemplate.find('.classTitle').html(parsedData.name+kind);
  //classTemplate.find('.classKind').html(parsedData.kind);
  classTemplate.find('.classDescription').html(parsedData.description);

  // Sections
  parsedData.sections.forEach(function (section) {
    // Menu
    $("#topics").append('<li class="chapter"><a href="#' + section.anchor + '">' + section.name + "</a></li>")


    // Section template
    var s = $('#sectionTemplate').clone().attr('id', section.anchor);
    s.children('.sectionHeader').text(section.name);
    if(section.description) {
      s.children('.sectionDescription').html(section.description);
    }

    // Iterate over all members in the section
    section.methods.forEach(function (memberGroup) {
      var member = memberGroup.implementations[0];

      // Set the #ID of the element
      var ref = member.ref;
      var m = $('#classMethodTemplate').clone().attr('id', ref);

      var header = m.find(".methodHeader").find('.methodHeaderBox');

      // Type
      //header.children('.arg').html(getTypeHtml(method.type));

      // Name
      header.children('.name').text(member.name);

      // Args
      //header.children('.args').text(method.argsstring);
      if(member.kind == "function"){
        header.children('.kind').text("()");
      } else {
        header.children('.kind').text(member.kind);
      }


      // Deprecated
      if (member.deprecated) {
        header.addClass("deprecatedMethod");
      }

      if (member.note) {
        header.children('.note').text(member.note);
      }

      // Description

      // Find the coresponding description in the doxygen generated html
      var methodDescription = m.find(".methodDescription");
      methodDescription.attr('id', ref + "_description");

      var first = true;
      // Iterate over all the variants of the member
      memberGroup.implementations.forEach(function(method){
        if(!first){
          methodDescription.append('<hr>');
        }

        var variantDesc = methodDescription.append('<div class="memberVariant">').children().last();
        variantDesc.append('<span class="type">'+getTypeHtml(method.type)+'</span>');
        variantDesc.append('<span class="name">'+method.name+'</span>');
        variantDesc.append('<span class="args">'+method.argsstring+'</span>');

        methodDescription.append('<div class="memberDocumentation">'+method.htmlDescription+"</div>");

        first = false;
      //  methodImplementations.append(method.name)
      });
      /*}else {
       console.error(name+" missing memeber description for "+method.name)
       }*/



      // Description Events
      header.attr('onClick', 'toggleDescription("#' + ref + '")');


      s.children('.sectionContent').append(m);

    });

    classTemplate.find(".classMethods").append(s)

  });

  $(".content").append(classTemplate)
}

// -----------

function generateToc(structure, tocInfo){
  var templateData = fs.readFileSync("templateToc.html");
  var $ = cheerio.load(templateData.toString());

  var c = $(".content");
  for(var category in structure['core']){
    var elm = c.append('<div class="section">').children().last();
    c.append(elm);

    elm.append('<h3>'+category+"</h3>");
    structure['core'][category].forEach(function(file){
      var desc = '';
      if(tocInfo[file]){
        desc = ' - '+tocInfo[file.name];
      }
      elm.append('<a href="'+file.name+'.html">'+file.name+"</a>"+desc+"<br>");
    })
  }
  // Write the file
  fs.writeFile("output/index.html", $.html());

}

// -----------

function generateSearchTocJSON(structure, tocInfo){
  // Write the file
  fs.writeFile("output/toc.js", "var ofToc = "+JSON.stringify(searchToc));
}

// -----------

function getTypeHtml(type){
  if (typeof type == "string") {
    //header.children('.type').text(method.type + " ");
    /*if (method.type == "") {
      header.children('.type').css("display", 'none');
    }*/
    return type + " ";
  } else {
    var refid = type.ref[0]['$']['refid'];
    var kindref = type.ref[0]['$']['kindref'];

    var url = refid+".html";
    if(kindref == 'member'){
      url = refid.replace(/(.+)_(.+)$/g, "$1.html#$2");
    }
    url = getLinkUrlFromDoxygenUrl(url);
    return ("<a href='"+url+"'>" + type.ref[0]._ + "</a> ");
  }
}

// -----------

function updateLink(elm){
  var ref = elm.attr('href');


  if(!ref){
    return;
  }

  //Ignore ref's with / in (they are external url's)
  if(ref.match(/\//g)){
    return;
  }

  //Ignore index.html
  if(ref.match(/^index\.html/g)){
    return;
  }

  //Ignore ref's starting with #
  if(ref.match(/^#/g)){
    return;
  }


  if(ref.match(/^deprecated/g)){
    ref = "";
  }
  else if(ref.match(/^todo/g)){
    ref = "";
  }

  ref = getLinkUrlFromDoxygenUrl(ref);

  elm.attr('href',ref);
}


function updateImageHref(elm){
  var src = elm.attr('src');


  // Check if the file is a local file
  if (!/^(?:[a-z]+:)?\/\//i.test(src)){
    elm.attr('src', "images/"+src);

  }
}

// ---------



function getLinkUrlFromDoxygenUrl(ref){
  if(ref.match(/^class/g)){
    ref = ref.replace(/^class/g,'');
    ref = ref.replace(/_\w/g, function(v){ return v.toUpperCase() });
    ref = ref.replace(/_/g,'');
  }
  if(ref.match(/^struct/g)){
    ref = ref.replace(/^struct/g,'');
    ref = ref.replace(/_\w/g, function(v){ return v.toUpperCase() });
    ref = ref.replace(/_/g,'');
  }

  else if(ref.match(/_8h/g)){
    ref = ref.replace(/_8h/g,'');

    ref = ref.replace(/_\w/g, function(v){ return v.toUpperCase() });
    ref = ref.replace(/_/g,'');
  }

  else {
    //console.error("weird link",ref);
    return ref;
  }
  return ref;
}