var fs = require('fs-extra'),
  util = require('util'),
  Q = require('q'),
  xml2js = require('xml2js'),
  cheerio = require('cheerio'),
  _ = require('underscore')._;



// Set this to the section you work on to speed up the generation.
// But remember to remove it again! :)
var filterGroup = 'communication';

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
//var dir = root + "/libs/openFrameworksCompiled/project/doxygen/build/";
var dir = "doxygen_build/";
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

var internalFiles = require('./internalFiles.json');

// Load the structure from the doxygen xml
loadStructure()

  // Then generate the docs of all the pages
  .then(function(structure){
    var promises = [];

    // Iterate over the categories
    for (var folder in structure['core']) {
      structure['core'][folder].forEach(function (fileDescription) {
        fileDescription.category = folder;

        // Mark files internal
        if(_.contains(internalFiles[folder], fileDescription.name)){
          fileDescription.internal = true;
        }
        else {
          // Generate the doc of the file
          var p = generateDoc(fileDescription)
            // If the doc fails, remove it from the structure so it's not shown on the frontpage
            .fail(function (e) {
              console.error("Error generating doc:", e, fileDescription, fileDescription.category)
              var index = structure['core'][fileDescription.category].indexOf(fileDescription);
              structure['core'][fileDescription.category].splice(index, 1);
            });
        }
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

  // Save current version info
  .then(saveInfoFile)

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

  // Iterate through all XML files in doxygen ouput folder
  var files = fs.readdirSync(dir+'xml');
  files.forEach(function(f){
    // Match if its a xml describing a dir
    if(f.match(/^dir_/)){
      var deferred = Q.defer();

      // Open and parse the XML file
      var xmlData = fs.readFileSync(dir+'xml/'+f);
      var xmlParser = new xml2js.Parser();
      xmlParser.parseString(xmlData, function (err, result) {
	var matches = result['doxygen']['compounddef'][0]['compoundname'][0].match(/\/(\w+)$/);
	if(matches.length >= 2){
		var compoundname = matches[1];

		// Filter out the root dir xml that descripes the openframeworks base folder
		if(!compoundname.match(/openframeworks$/i) && !compoundname.match(/libs$/i) ) {
		  //console.log('"' + compoundname + '"', '"' + filterGroup + '"', filterGroup != compoundname);

		  if (filterGroup && filterGroup != compoundname) {

		  } else {
		    structure.core[compoundname] = [];

		    // Iterate over the files described in the XML file
		    if(result['doxygen']['compounddef'][0]['innerfile']) {
		      result['doxygen']['compounddef'][0]['innerfile'].forEach(function (innerfile) {
			var filename = innerfile['_'];
			var refid = innerfile['$']['refid'];
			//Is it a headerfile?
			if (filename.match(/\.h$/)) {
			  structure.core[compoundname].push({
			    name: filename.replace(/\.h$/, ""),
			    filename: filename,
			    doxygen_ref: refid
			  })
			}
		      })
		    }
		  }
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
  var doxygenName = fileDescription.doxygen_ref;

  fileDescription.kind = 'file';
  fileDescription.url = fileDescription.name+".html";

  console.log("Generate "+fileDescription.name)

  // First parse the doxygen xml
  return parseDoxygenXml(doxygenName)
    .then(function(xmlData) {
      fileDescription.sections = xmlData.sections;
      fileDescription.classes = xmlData.classes;
    })

    // Then scrape the doxygen html for descriptions
    .then(function(){
      console.log("Scrape " + fileDescription.name)
      return scrapeDoxygenHtml(fileDescription);
    })

    .then(function(){
      var stats = getStatsOnObject(fileDescription);
      fileDescription.stats = stats;
      console.log(doxygenName+" completion rate: "+stats.docRate+"%");
    })

    // Then generate search toc object
    .then(function(){
      addFileToSearch(fileDescription);
    })

    // Then generate the html output
    .then(function(){
      console.log("Generate html "+fileDescription.name)

      return generateHtml(fileDescription);
    })

    // Then save the output file
    .then(function(html){
      //Save the html
      console.log("Save "+fileDescription.name)
      fs.writeFile("output/"+fileDescription.url, html);
    })
}



// -----------

function parseDoxygenXml(doxygenName){
  var deferred = Q.defer();

  var xmlPath = dir + "xml/" + doxygenName + ".xml";

  var xmlParseRet = {
    classes: [],
    sections: [],
    doxygen_ref: doxygenName,
  };

  //Load the doxygen xml file
  var xmlData = fs.readFileSync(xmlPath);
  var xmlParser = new xml2js.Parser();
  xmlParser.parseString(xmlData, function (err, result) {

    var promises = [];

    // The compounds in the XML
    var compounds = result['doxygen']['compounddef'];

    // Find the detailed description of the file, and see if its defined as Internal
    /*var simpleDescriptionSet = getNested(compounds, 0, 'detaileddescription', 0, 'para', 0, 'simplesect',0,'title',0)
     if(simpleDescriptionSet == 'Internal ') {
     ret.internal = true;
     }*/

    // compounds.length is always 1
    for (var i = 0; i < compounds.length; i++) {
      var compound = compounds[i];

      // Object name
      xmlParseRet.name = compound['compoundname'][0].replace(".h","");

      // Object url
      //xmlParseRet.url = compound['location'][0]['$']['file'].match(/\/(\w+).h$/)[1]+".html";

      // Object type
      xmlParseRet.kind = compound['$'].kind;
      // console.log(doxygenName,xmlParseRet.name, xmlParseRet.url,xmlParseRet.kind );

      // Brief description
      if (compound['briefdescription'].length == 1
        && compound['briefdescription'][0]['para']) {
        tocInfo[xmlParseRet.name] = compound['briefdescription'][0]['para'][0];
        xmlParseRet.briefDescription = compound['briefdescription'][0]['para'][0];
      } else {
        console.error("Missing briefDescription on " + xmlParseRet.name);
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
                section.name = "Functions";
                break;
              case 'public-type':
                section.name = "Types";
                break;
              case 'public-attrib':
                section.name = "Attributes";
                break;
              case 'public-static-func':
                section.name = "Static Functions";
                break;
              case 'public-static-attrib':
                section.name = "Static Attributes";
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
          if(s['memberdef']) {
            s['memberdef'].forEach(function (member) {
              var m = {
                info: member['$'],
                name: member.name[0],
                type: member.type ? member.type[0] : "",
                definition: member.definition ? member.definition[0] : "",
                argsstring: member.argsstring ? member.argsstring[0] : ""
              };

              // Member ref (anchor)
              m.doxygen_ref = m.info.id.replace(doxygenName + "_1", "");

              //console.log(member.definition[0]);

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
          }

          // Add the section
          xmlParseRet.sections.push(section);

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
              xmlParseRet.classes.push(classData);
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
        if(xmlParseRet.classes.length == 0 && xmlParseRet.sections.length == 0){
          // "Empty" file, let's remove it
          console.log(doxygenName + " is empty");
          deferred.reject("Object has no members or sections");
          return;
        }

        deferred.resolve(xmlParseRet);
      })
      .fail(function(e){
        deferred.reject(e);
      })

  });

  return deferred.promise;

}

// -----------

function scrapeDoxygenHtml(fileDescription){
  var promises = [];

  var htmlPath = dir + "html/" + fileDescription.doxygen_ref + ".html";

  if(!fs.existsSync(htmlPath)){
    console.error("Missing html for "+fileDescription.name + " "+htmlPath)
    return Q.all([]);
  }

  // Load HTML file
  var htmlData = fs.readFileSync(htmlPath);
  fileDescription.htmlData = htmlData;

  var $input = cheerio.load(htmlData.toString());

  // Overall description
  $input(".groupheader").each(function (i, elm) {
    if ($input(elm).text() == "Detailed Description") {
      fileDescription.html_description = $input(elm).next();
    }
  });


  // Inner Classes
  fileDescription.classes.forEach(function (innerclass) {
    var p = scrapeDoxygenHtml(innerclass);
    promises.push(p);
  });


  // Sections
  fileDescription.sections.forEach(function (section) {
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
        //var ref = method.info.id.replace(fileDescription.doxygen_ref + "_1", "");
        var ref = method.info.id.match(/^\w+_1([a-z0-9]+)$/)[1];
        var refElm = $input("#" + ref);

        if (!refElm) {
          console.error("Missing docs!")
        } else {
          var memitem = refElm.next();

          var memdoc = memitem.children('.memdoc');
          //if(memitem.is('.memdoc')) {
          if (memdoc.html()) {

            method.html_description = memdoc.html();
          }
        }
      })
    });
  });


  return Q.all(promises);
}

// ----------

function addFileToSearch(file){
  var path = [];

  // File / class
  searchToc.push({
    name: file.name,
    type: file.kind,
    ref: file.url,
    path: _.clone(path)
  });

  path.push(file.name)

  // Methods
  file.sections.forEach(function (section) {
    section.methods.forEach(function (method) {
      var ref = method.implementations[0].doxygen_ref;
      searchToc.push({
        name: method.implementations[0].name,
        type: method.implementations[0].info.kind,
        ref: file.url + "#" + ref,
        path: _.clone(path)
      })
    });
  });

  // Inner classes recursive add
  file.classes.forEach(function (innerclass) {
    innerclass.url = file.url;
    addFileToSearch(innerclass);
  });
}

// -----------

function generateHtml(fileDescription){
  // Load template
  var templateData = fs.readFileSync("templateDoc.html");
  var $ = cheerio.load(templateData.toString());

  // Page title
  $('title').text(fileDescription.name);

  //Quick nav
  $('#classQuickNav').text(fileDescription.name);
  $('#categoryQuickNav').text(fileDescription.category);


  // Global  members
  generateHtmlContent(fileDescription, $);

  // Inner classes
  fileDescription.classes.forEach(function(innerclass){
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
  classTemplate.find('.classDescription').html(parsedData.html_description);

  // Sections
  parsedData.sections.forEach(function (section) {
    // Menu
    $("#topics").append('<li class="chapter"><a href="#' + section.anchor + '">' + section.name + "</a></li>")


    // Section template
    var s = $('#sectionTemplate').clone().attr('id', section.anchor);
    s.children('.sectionHeader').text(section.name);
    if(section.html_description) {
      s.children('.sectionDescription').html(section.html_description);
    }

    // Iterate over all members in the section
    section.methods.forEach(function (memberGroup) {
      var member = memberGroup.implementations[0];

      // Set the #ID of the element
      var ref = member.doxygen_ref;
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

        methodDescription.append('<div class="memberDocumentation">'+method.html_description+"</div>");

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
  var templateData = fs.readFileSync("templateIndex.html");
  var $ = cheerio.load(templateData.toString());

  var c = $(".content");
  for(var category in structure['core']){
    var elm = c.append('<div class="section">').children().last();
    c.append(elm);

    elm.append('<h3>'+category+"</h3>");
    structure['core'][category].forEach(function(file){
      if(!file.internal) {
        if (file.stats.docRate > 0.8) {
          l = 'label-success';
        } else if (file.stats.docRate > 0.3) {
          l = 'label-warning';
        } else {
          l = 'label-danger';
        }

        var pct = " <span class='label " + l + "'> " + Math.round(file.stats.docRate * 100) + "%" + "</span>";
        var desc = "";
        if (tocInfo[file]) {
          desc = ' - ' + tocInfo[file.name];
        }
        elm.append(pct + ' <a href="' + file.name + '.html">' + file.name + "</a>" + desc + "<br>");
      }
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

function getStatsOnObject(parsedData){

  var numMembers = 0;
  var numMembersWithDoc = 0;

  parsedData.sections.forEach(function (section) {
    section.methods.forEach(function (memberGroup) {
      memberGroup.implementations.forEach(function(method) {
        if(method.html_description && method.html_description.trim().length > 0){
          numMembersWithDoc ++;
        }
        numMembers++;
      });
    });
  });

  parsedData.classes.forEach(function(innerclass) {
    var stats = getStatsOnObject(innerclass);
    numMembers += stats.numMembers;
    numMembersWithDoc += stats.numMembersWithDoc;
  });

  return { numMembers: numMembers, numMembersWithDoc: numMembersWithDoc, docRate: numMembersWithDoc/numMembers}
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
  else if(ref.match(/^singleton/g)){
    ref = ref.replace(/^singleton/g,'');
    ref = ref.replace(/_\w/g, function(v){ return v.toUpperCase() });
    ref = ref.replace(/_/g,'');
  }
  else if(ref.match(/^struct/g)){
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


function saveInfoFile(){
  var info = {
    date: new Date()
  }
  fs.writeFile('output/info.js',"var info="+JSON.stringify(info));
}