var fs = require('fs-extra'),
  util = require('util'),
  Q = require('Q'),
  xml2js = require('xml2js'),
  cheerio = require('cheerio'),
  sass = require('node-sass');

var root =  process.argv[2] || "../../";
var dir = root + "libs/openFrameworksCompiled/project/doxygen/build/";
console.log("Openframeworks root: "+root);

//Create the output folder
if(fs.existsSync('output'))
  fs.removeSync('output');
fs.mkdirSync('output');
fs.copySync('assets/script.js', 'output/script.js');

//Create the css file from the scss file in assets
sass.renderFile({
  file: 'assets/stylesheet.scss',
  outFile: 'output/stylesheet.css',
  error: function(error) {
    console.error(error);
  },
  success: function(){}
});



// Load the doc structure
var structure = require("./structure.json");
structure = {core: {"utils": ['ofThread','ofLog', 'ofColor']}}
var tocInfo = {};

// Generate the docs
for(var category in structure['core']){
  structure['core'][category].forEach(function(file){
    generateDoc(file, category);
  })
}

// Generate the TOC (index.html)
generateToc(structure, tocInfo);



// ---------

function generateDoc(className, category) {
  var doxygenName = className.replace(/([A-Z])/g, "_$1").toLowerCase();

  /*if(fs.existsSync(dir + "xml/class"+doxygenName+ ".xml")){
   doxygenName = "class"+doxygenName;
   }

   els*e*/

  parseDoxygenXml(doxygenName+"_8h")
    .then(function(parseData) {
      return scrapeDoxygenHtml(parseData);
    })
    .then(function(parseData){
      return generateHtml(parseData, category);
    })
    .then(function(html){
      //Save the html
      fs.writeFile("output/"+className+".html", html);
    })

    .fail(function(e){
      console.error(e)
    })
}



// -----------

function parseDoxygenXml(doxygenName){
  var deferred = Q.defer();


  /*  if(fs.existsSync(dir + "xml/"+doxygenName+ "_8h.xml")){
   doxygenName = doxygenName+"_8h";
   }
   else {
   console.error("NO XML FOR "+className);
   return;
   }*/


  var ret = {
    classes: [],
    sections: [],
    doxygenName: doxygenName,
    xmlPath: dir + "xml/" + doxygenName + ".xml",
    htmlPath: dir + "html/" + doxygenName + ".html"
  };

  var xmlData = fs.readFileSync(ret.xmlPath);
  var xmlParser = new xml2js.Parser();
  xmlParser.parseString(xmlData, function (err, result) {

    var promises = [];


    var compounds = result['doxygen']['compounddef'];

    for (var i = 0; i < compounds.length; i++) {
      var compound = compounds[i];



      // Site name
      ret.name = compound['compoundname'][0];

      // Bried description
      if (compound['briefdescription'].length == 1
        && compound['briefdescription'][0]['para']) {
        tocInfo[ret.name] = compound['briefdescription'][0]['para'][0];
      } else {
        console.error("Missing briefDescription on " + ret.name);
      }

      // Inner classes
      if (compound['innerclass']) {

        compound['innerclass'].forEach(function (innerclass) {
          var classDoxygenName = innerclass['$']['refid'];
          var className = innerclass['_'];

          var p = parseDoxygenXml(classDoxygenName).then(function(classData){
            ret.classes.push(classData);
          });

          promises.push(p);

        });
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


          // Memebers in the section
          s.memberdef.forEach(function (member) {
            var m = {
              info: member['$'],
              name: member.name[0],
              type: member.type ? member.type[0] : "",
              definition: member.definition ? member.definition[0] : "",
              argsstring: member.argsstring ? member.argsstring[0] : ""
            };

            /*if(member.type['ref']){

             }*/

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
                console.log(m.argsstring);
                console.error(e);
              }
              //console.log(m.type, m.name, m.argsstring)
            }

            section.methods.push(m);

            //console.log(memberType,name)
            // console.log(util.inspect(member, false, null))
          });

          // Add the section
          ret.sections.push(section);

          //console.log(util.inspect(section, false, null))
        });
      }
      //console.log(util.inspect(compound, false, null))
    }


    Q.all(promises).then(function(){
      console.log("Done with "+doxygenName)
      deferred.resolve(ret);
    });

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
    section.methods.forEach(function (method) {

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

    });
  });


  return Q.all(promises).then(function(){
    return parsedData;
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



  generateHtmlContent(parsedData, $);

  parsedData.classes.forEach(function(innerclass){
    $("#topics").append('<span class="class">'+innerclass.name+'</span>');

    generateHtmlContent(innerclass, $);
  });


  // update links
  var links = $('a');
  links.each(function(i,elm){
    updateLink($(this));
  });

  return $.html();
}

// -----------

function generateHtmlContent(parsedData, $){

  var classTemplate = $('#classTemplate').clone().attr('id','');

  // Class description
  classTemplate.find('.classTitle').html(parsedData.name);
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
    section.methods.forEach(function (method) {
      var ref = method.info.id.replace(parsedData.doxygenName + "_1", "");


      var m = $('#classMethodTemplate').clone().attr('id', ref);

      var header = m.find(".methodHeader");

      // Type
      if (typeof method.type == "string") {
        header.children('.type').text(method.type + " ");
        if (method.type == "") {
          header.children('.type').css("display", 'none');
        }
      } else {
        var refid = method.type.ref[0]['$']['refid'];
        var kindref = method.type.ref[0]['$']['kindref'];

        var url = refid+".html";
        if(kindref == 'member'){
          url = refid.replace(/(.+)_(.+)$/g, "$1.html#$2");
        }
        url = getLinkUrlFromDoxygenUrl(url);
        header.children('.type').html("<a href='"+url+"'>" + method.type.ref[0]._ + "</a>");
      }

      // Name
      header.children('.name').text(method.name);

      // Args
      header.children('.args').text(method.argsstring);


      // Deprecated
      if (method.deprecated) {
        header.addClass("deprecatedMethod");
      }

      if (method.note) {
        header.children('.note').text(method.note);
      }

      // Description

      // Find the coresponding description in the doxygen generated html


      var methodDescription = m.find(".methodDescription");
      methodDescription.html(method.htmlDescription);
      methodDescription.attr('id', ref + "_description")
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
    c.append('<h3>'+category+"</h3>");
    structure['core'][category].forEach(function(file){
      var desc = '';
      if(tocInfo[file]){
        desc = ' - '+tocInfo[file];
      }
      c.append('<a href="'+file+'.html">'+file+"</a>"+desc+"<br>");
    })
  }
  // Write the file
  fs.writeFile("output/index.html", $.html());

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