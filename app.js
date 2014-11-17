var fs = require('fs-extra'),
  xml2js = require('xml2js'),
  cheerio = require('cheerio'),
  sass = require('node-sass');


var dir = "../../libs/openFrameworksCompiled/project/doxygen/build/";


//Create the output folder
if(fs.existsSync('output'))
  fs.removeSync('output');
fs.mkdirSync('output');
fs.copySync('assets/script.js', 'output/script.js');

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
var tocInfo = {};

// Generate the docs
for(var category in structure['core']){
  structure['core'][category].forEach(function(file){
    console.log(category, file)
    generateDoc(file, category);
  })
}

// Generate the TOC (index.html)
generateToc(structure, tocInfo);



// ---------

function generateDoc(className, category) {
  var doxygenName = className.replace(/([A-Z])/g, "_$1").toLowerCase();

  if(fs.existsSync(dir + "xml/class"+doxygenName+ ".xml")){
    doxygenName = "class"+doxygenName;
  }

  else if(fs.existsSync(dir + "xml/"+doxygenName+ "_8h.xml")){
    doxygenName = doxygenName+"_8h";
  }
  else {
    console.error("NO XML FOR "+className);
    return;
  }

  var xmlData = fs.readFileSync(dir + "xml/" + doxygenName + ".xml");
  var htmlData = fs.readFileSync(dir + "html/" + doxygenName + ".html");
  var templateData = fs.readFileSync("template.html");

  var xmlParser = new xml2js.Parser();
  xmlParser.parseString(xmlData, function (err, result) {

    var $input = cheerio.load(htmlData.toString());
    var $ = cheerio.load(templateData.toString());


    var sections = [];

    var compounds = result['doxygen']['compounddef'];

    for (var i = 0; i < compounds.length; i++) {
      var compound = compounds[i];

      // Site name
      var name = compound['compoundname'][0];

      if(compound['briefdescription'].length == 1
        && compound['briefdescription'][0]['para']){
        tocInfo[name] = compound['briefdescription'][0]['para'][0];
      } else {
        console.error("Missing briefDescription on "+name);
      }

      // Sections
      if(compound['sectiondef']) {
        compound['sectiondef'].forEach(function (s) {
          var section = {
            name: "",
            methods: [],
            user_defined: true
          };

          // Section name
          if (s.header) {
            // User generated name
            section.name = s.header[0]
          } else {
            // Default names
            switch (s['$'].kind) {
              case 'public-func':
                section.name = "Public Functions"
                break;
              case 'public-type':
                section.name = "Public Types"
                break;
              case 'public-attrib':
                section.name = "Public Attributes"
                break;
              case 'public-static-func':
                section.name = "Public Static Functions"
                break;
              case 'public-static-attrib':
                section.name = "Public Static Attributes"
                break;

              case 'protected-attrib':
                section.name = "Protected Attributes"
                break;

              case 'protected-static-attrib':
                section.name = "Protected Static Attributes"
                break;
              case 'protected-func':
                section.name = "Protected Functions"
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
                console.error("Missing header name for "+s['$'].kind);

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
              } catch(e){
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
          sections.push(section);

          //console.log(util.inspect(section, false, null))
        });
      }
      //console.log(util.inspect(compound, false, null))
    }

    // Page title
    $('#title').text(name);
    $('title').text(name);

    //Quick nav
    $('#classQuickNav').text(name);
    $('#categoryQuickNav').text(category);


    // Class description
    $input(".groupheader").each(function (i, elm) {
      if ($input(elm).text() == "Detailed Description") {
        $('.classDescription').html($input(elm).next())
      }
    });


    // Sections
    sections.forEach(function (section) {
      // Menu
      $("#topics").append('<li class="chapter"><a href="#' + section.anchor + '">' + section.name + "</a></li>")


      // Template
      var s = $('#sectionTemplate').clone().attr('id', section.anchor);
      s.children('.sectionHeader').text(section.name)

      section.methods.forEach(function (method) {
        var ref = method.info.id.replace(doxygenName + "_1", "");


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
        var refElm = $input("#" + ref);

        if (!ref || !refElm) {
          console.error("Missing docs!")
        } else {
          var memitem = refElm.next();

          var memdoc = memitem.children('.memdoc');
          //if(memitem.is('.memdoc')) {

          var methodDescription = m.find(".methodDescription");
          if (memdoc.html()) {
            methodDescription.html(memdoc.html());
            methodDescription.attr('id', ref + "_description")
          }
          /*}else {
            console.error(name+" missing memeber description for "+method.name)
          }*/

        }

        // Description Events
        header.attr('onClick', 'toggleDescription("#' + ref + '")');


        s.children('.sectionContent').append(m);

      });

      $(".classMethods").append(s)

    });

    // update links
    var links = $('a');
    links.each(function(i,elm){
     // updateLink($(this));
    });


    // Write the file
    fs.writeFile("output/"+className+".html", $.html());

  })
}
// ---------

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
    console.error("weird link",ref);
    return ref;
  }
  return ref;
}